import type { GatewayContext } from "./context.ts";
import type { DatabaseProvider } from "./database.ts";
import { createDeviceSession, pollDeviceSession } from "./device.ts";
import { createDiscordApi, type DiscordApi, type DiscordCredentials } from "./discord.ts";
import { errorJson, GatewayError, json, readJsonObject } from "./http.ts";
import { completeOAuth, startOAuth } from "./oauth.ts";
import { isDiscordSnowflake, isForwardedOrigin } from "./policy.ts";
import { claimSponsorship, removeSponsoredAccount, rotateSponsorCode, sponsorPortal } from "./sponsor.ts";
import { cryptoRandomBytes, type RandomBytes, secretsEqual } from "./tokens.ts";

const FUNCTION_PREFIXES = Object.freeze(["/functions/v1/nightly-gateway", "/nightly-gateway"]);
const FORWARDED_ORIGIN_HEADER = "x-nightly-forwarded-origin";
const WEBSITE_KEY_HEADER = "x-nightly-website-key";

type InstallerRoute = (context: GatewayContext, request: Request, origin: string) => Promise<Response>;
type WebsiteRoute = (context: GatewayContext, body: Record<string, unknown>) => Promise<Response>;

const INSTALLER_ROUTES: Readonly<Record<string, InstallerRoute>> = Object.freeze({
    "/v1/device/sessions": (context: GatewayContext, _request: Request, origin: string) => createDeviceSession(context, origin),
    "/v1/device/token": (context: GatewayContext, request: Request) => pollDeviceSession(context, request),
});

const WEBSITE_ROUTES: Readonly<Record<string, WebsiteRoute>> = Object.freeze({
    "/oauth/start": startOAuth,
    "/oauth/complete": completeOAuth,
    "/sponsorship/claim": claimSponsorship,
    "/sponsor/portal": sponsorPortal,
    "/sponsor/code": rotateSponsorCode,
    "/sponsor/remove": removeSponsoredAccount,
});

/** Secrets and collaborators for the nightly-gateway Edge Function; everything platform-bound is injected. */
export type NightlyGatewayOptions = {
    websiteKey: string;
    discord: DiscordCredentials;
    fetch: typeof fetch;
    openDatabase: DatabaseProvider;
    /** Wall-clock milliseconds, like Date.now. */
    clock?: () => number;
    random?: RandomBytes;
    log?: (event: Record<string, unknown>) => void;
};

/** Builds the Edge Function's request handler: installer device routes plus the website's JSON routes. */
export function createNightlyGatewayHandler(options: NightlyGatewayOptions): (request: Request) => Promise<Response> {
    assertConfiguration(options);
    const discord = createDiscordApi(options.discord, options.fetch);
    const clock = options.clock ?? Date.now;
    const random = options.random ?? cryptoRandomBytes;
    const log = options.log ?? ((event) => console.error(JSON.stringify(event)));
    const router = new GatewayRouter(options, discord, () => Math.floor(clock() / 1000), random);
    return async (request) => {
        try {
            return await router.route(request);
        } catch (error) {
            return failureResponse(request, error, log);
        }
    };
}

// Authenticates each request for its route family and runs the route on a request-scoped database.
class GatewayRouter {
    constructor(
        private readonly options: NightlyGatewayOptions,
        private readonly discord: DiscordApi,
        private readonly now: () => number,
        private readonly random: RandomBytes,
    ) {}

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

    /** Requires a forwarded gateway origin, then runs an installer route. */
    private async routeInstaller(request: Request, route: InstallerRoute): Promise<Response> {
        const origin = request.headers.get(FORWARDED_ORIGIN_HEADER);
        if (!isForwardedOrigin(origin)) throw new GatewayError(400, "invalid_request");
        return this.withContext((context) => route(context, request, origin));
    }

    /** Requires the website key, parses the JSON body, then runs a website route. */
    private async routeWebsite(request: Request, route: WebsiteRoute): Promise<Response> {
        const provided = request.headers.get(WEBSITE_KEY_HEADER);
        if (provided === null || !await secretsEqual(this.options.websiteKey, provided)) {
            throw new GatewayError(401, "unauthorized");
        }
        const body = await readJsonObject(request);
        return this.withContext((context) => route(context, body));
    }

    /** Leases a database for one route invocation and always releases it, discarding it after an unexpected failure. */
    private async withContext(run: (context: GatewayContext) => Promise<Response>): Promise<Response> {
        const lease = await this.options.openDatabase();
        let failed = false;
        try {
            return await run({ db: lease.database, discord: this.discord, now: this.now, random: this.random });
        } catch (error) {
            failed = !(error instanceof GatewayError);
            throw error;
        } finally {
            await lease.release(failed);
        }
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
function failureResponse(request: Request, error: unknown, log: (event: Record<string, unknown>) => void): Response {
    const gatewayError = error instanceof GatewayError ? error : null;
    log({
        event: "nightly_gateway_request_failed",
        path: new URL(request.url).pathname,
        error: gatewayError?.code ?? "internal_error",
        ...gatewayError?.upstream,
    });
    if (gatewayError !== null) return errorJson(gatewayError);
    return json({ error: "internal_error" }, 500);
}

/** Refuses to start with a missing or implausible secret instead of failing per request. */
function assertConfiguration(options: NightlyGatewayOptions): void {
    if (typeof options.websiteKey !== "string" || options.websiteKey.length < 32
        || !isDiscordSnowflake(options.discord.clientId)
        || typeof options.discord.clientSecret !== "string" || options.discord.clientSecret.length < 32
        || typeof options.discord.botToken !== "string" || options.discord.botToken.length < 50) {
        throw new Error("nightly_gateway_configuration_invalid");
    }
}
