import { serveArtifact } from "./artifacts";
import { databaseForRequest } from "./database";
import { FORWARDED_DEVICE_PATHS, deviceFunctionUrl, forwardDeviceRequest } from "./forwarding";
import { GatewayError, json, safeErrorCode, type GatewayLog, type UpstreamFetch } from "./http";
import { serveManifest } from "./manifests";
import { PUBLIC_MANUAL_SERVER_ORIGIN, resolveGatewayOrigin } from "./origins";
import { errorPage, gatewayErrorMessage, html } from "./pages";
import {
    mintCreateBuildPin,
    redeemCreateBuildPin,
    serveCreateBuildPinLauncher,
    serveCreateBuildPinPage,
    servePinManifest,
} from "./pins";
import { websiteRedirectFor } from "./redirects";

/** Outside services the gateway uses; injected so tests can stand in for the Edge Function and collect logs. */
export type GatewayDependencies = { fetch: UpstreamFetch; log?: GatewayLog };

/** The Worker entry point: one fetch handler bound to its dependencies. */
export type GatewayHandler = {
    fetch(request: Request, env: Env, context?: ExecutionContext): Promise<Response>;
};

// Writes one structured event as a JSON line on the Worker's error log.
function consoleLog(event: Record<string, unknown>): void {
    console.error(JSON.stringify(event));
}

// Builds the Worker fetch handler around its outbound dependencies.
// Errors become stable JSON codes, or the HTML error page for browsers.
export function createGateway(dependencies: GatewayDependencies): GatewayHandler {
    const log = dependencies.log ?? consoleLog;
    return {
        async fetch(request: Request, env: Env): Promise<Response> {
            try {
                return await route(request, env, dependencies.fetch, log);
            } catch (error) {
                logRequestFailure(log, request, error);
                if (!(error instanceof GatewayError)) return json({ error: "internal_error" }, 500);
                if (prefersHtmlError(request)) return html(errorPage(gatewayErrorMessage(error.code)), error.status);
                return json({ error: error.code }, error.status);
            }
        },
    };
}

export default createGateway({ fetch: (url, init) => fetch(url, init), log: consoleLog }) satisfies ExportedHandler<Env>;

// Logs a failed request with its stable code and, when known, the class of the underlying cause.
// The cause's message is logged only when it is a bare snake_case code; any other text is never logged.
function logRequestFailure(log: GatewayLog, request: Request, error: unknown): void {
    log({
        event: "nightly_gateway_request_failed",
        path: new URL(request.url).pathname,
        error: error instanceof GatewayError ? error.code : "internal_error",
        ...describeFailureCause(error),
    });
}

// Describes the failure behind a request: a GatewayError's cause, or the unexpected error itself.
// Yields its class and, when safe, its snake_case code; a GatewayError without an Error cause yields nothing.
function describeFailureCause(error: unknown): { cause?: string; message?: string } {
    const cause = error instanceof GatewayError ? error.cause : error;
    if (cause instanceof Error) return { cause: cause.name, ...safeMessage(cause) };
    if (error instanceof GatewayError) return {};
    return { cause: typeof error };
}

// Carries an error's message for the log only when it is a bare snake_case code.
function safeMessage(error: Error): { message?: string } {
    const message = safeErrorCode(error);
    if (message === undefined) return {};
    return { message };
}

// Routes one request: maintenance lock first, then the stateless redirect and device-forwarding routes,
// then the R2 and Postgres routes.
async function route(request: Request, env: Env, upstreamFetch: UpstreamFetch, log: GatewayLog): Promise<Response> {
    assertConfiguration(env);
    const url = new URL(request.url);
    if (env.MIGRATION_MODE !== undefined && env.MIGRATION_MODE !== "locked") {
        throw new Error("gateway_migration_mode_invalid");
    }
    if (env.MIGRATION_MODE === "locked") {
        if (request.method === "GET" && url.pathname === "/health") {
            return json({ ok: false, maintenance: true }, 503);
        }
        throw new GatewayError(503, "migration_in_progress");
    }
    const redirect = websiteRedirectFor(request.method, url);
    if (redirect !== null) return redirectResponse(redirect.location, redirect.status);
    if (request.method === "POST" && FORWARDED_DEVICE_PATHS.includes(url.pathname)) {
        return forwardDeviceRequest(request, {
            path: url.pathname,
            url: deviceFunctionUrl(env.NIGHTLY_FUNCTION_URL, url.pathname),
            origin: resolveGatewayOrigin(url),
        }, upstreamFetch);
    }
    const database = await databaseForRequest(env);
    return routeWithDatabase(request, url, { ...env, DB: database }, upstreamFetch, log);
}

// Serves the pin, manifest, artifact, and health routes that read download state from Postgres.
async function routeWithDatabase(
    request: Request,
    url: URL,
    env: Env,
    upstreamFetch: UpstreamFetch,
    log: GatewayLog,
): Promise<Response> {
    if (request.method === "GET" && url.pathname === "/install" && url.searchParams.has("pin")) {
        return serveCreateBuildPinPage(url, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/pins/install.cmd") {
        return serveCreateBuildPinLauncher(url, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/pins") {
        return mintCreateBuildPin(request, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/pins/token") {
        return redeemCreateBuildPin(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/manifests/pin") {
        return servePinManifest(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/manifests/client") {
        return serveManifest(request, env, true, { fetch: upstreamFetch, log });
    }
    if (request.method === "GET" && url.pathname === "/v1/manifests/release") {
        return serveManifest(request, env, false, { fetch: upstreamFetch, log });
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/artifacts/")) {
        return serveArtifact(request, env, url.pathname.slice("/v1/artifacts/".length));
    }
    if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true });
    }
    throw new GatewayError(404, "not_found");
}

// Sends a browser to a moved page without caching the redirect body.
function redirectResponse(location: string, status: number): Response {
    return new Response(null, { status, headers: { location, "cache-control": "no-store" } });
}

// Rejects a deploy whose fixed R2 origin was changed; the gateway origin now comes from each request.
function assertConfiguration(env: Env): void {
    if (env.LEGACY_R2_ORIGIN !== PUBLIC_MANUAL_SERVER_ORIGIN) {
        throw new Error("gateway_configuration_invalid");
    }
}

// Tells whether the caller is a browser that should get the HTML error page instead of JSON.
function prefersHtmlError(request: Request): boolean {
    return (request.headers.get("accept") ?? "").includes("text/html");
}
