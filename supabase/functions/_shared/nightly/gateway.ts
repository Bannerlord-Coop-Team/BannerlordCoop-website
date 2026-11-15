import type { GatewayContext } from "./context.ts";
import { driverCode, type GatewayDatabase } from "./database.ts";
import { createDeviceSession, pollDeviceSession } from "./device.ts";
import { configurationInvalid, hasMinimumLength } from "./configuration.ts";
import { assertDiscordCredentials, createDiscordApi, type DiscordCredentials } from "./discord.ts";
import { WEBSITE_KEY_HEADER } from "./formats.ts";
import { errorJson, GatewayError, json, readJsonObject } from "./http.ts";
import { type GatewayLog, logToStderr } from "./log.ts";
import { completeOAuth, startOAuth } from "./oauth.ts";
import { claimSponsorship, createSponsorCode, removeSponsoredAccount, sponsorPortal } from "./sponsor.ts";
import { cryptoRandomBytes, type RandomBytes, secretsEqual } from "./tokens.ts";

const FUNCTION_PREFIXES = Object.freeze(["/functions/v1/nightly-gateway", "/nightly-gateway"]);
const MINIMUM_WEBSITE_KEY_LENGTH = 32;
/** A snake_case error code this code base throws as a plain Error's message; any other message is never logged. */
const SAFE_ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

type InstallerRoute = (context: GatewayContext, request: Request) => Promise<Response>;
type WebsiteRoute = (context: GatewayContext, body: Record<string, unknown>) => Promise<Response>;

const INSTALLER_ROUTES: Readonly<Record<string, InstallerRoute>> = Object.freeze({
    "/v1/device/sessions": (context: GatewayContext) => createDeviceSession(context),
    "/v1/device/token": pollDeviceSession,
});

const WEBSITE_ROUTES: Readonly<Record<string, WebsiteRoute>> = Object.freeze({
    "/oauth/start": startOAuth,
    "/oauth/complete": completeOAuth,
    "/sponsorship/claim": claimSponsorship,
    "/sponsor/portal": sponsorPortal,
    "/sponsor/code": createSponsorCode,
    "/sponsor/remove": removeSponsoredAccount,
});

/** Secrets and collaborators for the nightly-gateway Edge Function; everything platform-bound is injected. */
export type NightlyGatewayOptions = {
    websiteKey: string;
    discord: DiscordCredentials;
    fetch: typeof fetch;
    /** Pool-backed: each statement or transaction holds a connection only while it runs. */
    database: GatewayDatabase;
    /** Wall-clock milliseconds, like Date.now. */
    clock?: () => number;
    random?: RandomBytes;
    /** Receives one structured event per failed request; defaults to JSON on stderr. */
    log?: GatewayLog;
};

/** Builds the Edge Function's request handler: installer device routes plus the website's JSON routes. */
export function createNightlyGatewayHandler(options: NightlyGatewayOptions): (request: Request) => Promise<Response> {
    assertConfiguration(options);
    const clock = options.clock ?? Date.now;
    const log = options.log ?? logToStderr;
    const router = new GatewayRouter(options.websiteKey, {
        db: options.database,
        discord: createDiscordApi(options.discord, options.fetch),
        now: () => Math.floor(clock() / 1000),
        random: options.random ?? cryptoRandomBytes,
    });
    return async (request) => {
        try {
            return await router.route(request);
        } catch (error) {
            return failureResponse(request, error, log);
        }
    };
}

// Authenticates each request for its route family and runs the route with the gateway's shared context.
class GatewayRouter {
    constructor(private readonly websiteKey: string, private readonly context: GatewayContext) {}

    /** Dispatches a request by its function-relative path; unknown paths and non-POSTs are `404 not_found`. */
    async route(request: Request): Promise<Response> {
        const path = functionPath(new URL(request.url).pathname);
        if (request.method !== "POST" || path === null) throw new GatewayError(404, "not_found");
        const installerRoute = INSTALLER_ROUTES[path];
        if (installerRoute !== undefined) return this.routeInstaller(request, installerRoute);
        const websiteRoute = WEBSITE_ROUTES[path];
        if (websiteRoute !== undefined) return this.routeWebsite(request, websiteRoute);
        throw new GatewayError(404, "not_found");
    }

    /** Runs an installer route; the Worker forwards these unauthenticated, as installers send them. */
    private async routeInstaller(request: Request, route: InstallerRoute): Promise<Response> {
        return route(this.context, request);
    }

    /** Requires the website key, parses the JSON body, then runs a website route. */
    private async routeWebsite(request: Request, route: WebsiteRoute): Promise<Response> {
        const provided = request.headers.get(WEBSITE_KEY_HEADER);
        if (provided === null || !secretsEqual(this.websiteKey, provided)) {
            throw new GatewayError(401, "unauthorized");
        }
        const body = await readJsonObject(request);
        return route(this.context, body);
    }
}

/** Strips the Edge Function prefix the runtime may include; paths outside the function are null. */
function functionPath(pathname: string): string | null {
    for (const prefix of FUNCTION_PREFIXES) {
        if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
    }
    return null;
}

/** Maps a gateway error to its JSON envelope and anything else to a logged `500 internal_error`. */
function failureResponse(request: Request, error: unknown, log: GatewayLog): Response {
    const failure = { event: "nightly_gateway_request_failed", path: new URL(request.url).pathname };
    if (error instanceof GatewayError) {
        log({ ...failure, error: error.code, ...error.upstream });
        return errorJson(error);
    }
    log({ ...failure, error: "internal_error", ...unexpectedCause(error) });
    return json({ error: "internal_error" }, 500);
}

/** Describes an unexpected failure by error class, safe snake_case message and driver code only, never other text. */
function unexpectedCause(error: unknown): { cause: string; message?: string; code?: string; sqlstate?: string } {
    const cause = error instanceof Error ? error.name : typeof error;
    return { cause, ...safeMessage(error), ...driverCode(error) };
}

/** The error's message only when it is one of the gateway's own snake_case codes, like `postgres_integer_out_of_range`. */
function safeMessage(error: unknown): { message?: string } {
    if (!(error instanceof Error) || !SAFE_ERROR_CODE_PATTERN.test(error.message)) return {};
    return { message: error.message };
}

/** Refuses to start with a missing or implausible secret or setting instead of failing per request. */
function assertConfiguration(options: NightlyGatewayOptions): void {
    if (!hasMinimumLength(options.websiteKey, MINIMUM_WEBSITE_KEY_LENGTH)) throw configurationInvalid("websiteKey");
    assertDiscordCredentials(options.discord);
}
