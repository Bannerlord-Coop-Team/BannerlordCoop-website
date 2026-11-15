import { PUBLIC_MANUAL_SERVER_ORIGIN, resolveGatewayOrigin } from "./core";
import { serveArtifact } from "./artifacts";
import { databaseForRequest } from "./database";
import { FORWARDED_DEVICE_PATHS, deviceFunctionUrl, forwardDeviceRequest, type UpstreamFetch } from "./forwarding";
import { GatewayError, json, type GatewayLog } from "./http";
import { serveManifest } from "./manifests";
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

// Logs a failed request with its stable code and, when known, the class of the underlying cause (never its message).
function logRequestFailure(log: GatewayLog, request: Request, error: unknown): void {
    const cause = failureCauseName(error);
    log({
        event: "nightly_gateway_request_failed",
        path: new URL(request.url).pathname,
        error: error instanceof GatewayError ? error.code : "internal_error",
        ...(cause === undefined ? {} : { cause }),
    });
}

// Names the class behind a failure: a GatewayError's cause, or the unexpected error itself.
function failureCauseName(error: unknown): string | undefined {
    if (error instanceof GatewayError) return error.cause instanceof Error ? error.cause.name : undefined;
    return error instanceof Error ? error.name : typeof error;
}

// Routes one request: maintenance lock first, then routes that need no database, then R2 and Postgres routes.
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
    const stateless = routeWithoutDatabase(request, url, env, upstreamFetch);
    if (stateless !== null) return stateless;
    const database = await databaseForRequest(env);
    return routeWithDatabase(request, url, { ...env, DB: database }, log);
}

// Answers the website redirects and the device-API forwarding, which never touch Postgres or R2.
function routeWithoutDatabase(
    request: Request,
    url: URL,
    env: Env,
    upstreamFetch: UpstreamFetch,
): Promise<Response> | null {
    const redirect = websiteRedirectFor(request.method, url);
    if (redirect !== null) return Promise.resolve(redirectResponse(redirect.location, redirect.status));
    if (request.method !== "POST" || !FORWARDED_DEVICE_PATHS.includes(url.pathname)) return null;
    return forwardDeviceRequest(request, {
        url: deviceFunctionUrl(env.NIGHTLY_FUNCTION_URL, url.pathname),
        origin: resolveGatewayOrigin(url),
    }, upstreamFetch);
}

// Serves the pin, manifest, artifact, and health routes that read download state from Postgres.
async function routeWithDatabase(request: Request, url: URL, env: Env, log: GatewayLog): Promise<Response> {
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
        return serveManifest(request, env, true, log);
    }
    if (request.method === "GET" && url.pathname === "/v1/manifests/release") {
        return serveManifest(request, env, false, log);
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
