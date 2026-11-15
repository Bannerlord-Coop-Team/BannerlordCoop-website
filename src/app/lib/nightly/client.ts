import type { NightlyConfig } from "./config";

/** A failed Edge Function call: HTTP status (0 when no response arrived) and a sanitized error code. */
export type NightlyFailure = { ok: false; status: number; code: string };
export type NightlyResult<T> = { ok: true; value: T } | NightlyFailure;

export type OAuthOutcome =
    | { outcome: "approved" }
    | { outcome: "sponsored-approved" }
    | { outcome: "needs-sponsor"; device_id: string; username: string; previous_sponsor_revoked: boolean }
    | { outcome: "portal"; session: string; expires_in: number };

export type SponsorSeat = { discordUserId: string; createdAt: Date | null };
export type SponsorPortalData = { seats: SponsorSeat[]; limit: number };

export type NightlyFetch = (input: string, init: RequestInit) => Promise<Response>;

export type NightlyClient = {
    startDeviceOAuth(userCode: string): Promise<NightlyResult<string>>;
    startSponsorOAuth(): Promise<NightlyResult<string>>;
    completeOAuth(code: string, state: string): Promise<NightlyResult<OAuthOutcome>>;
    claimSponsorship(deviceId: string, sponsorCode: string): Promise<NightlyResult<null>>;
    sponsorPortal(session: string): Promise<NightlyResult<SponsorPortalData>>;
    createSponsorCode(session: string): Promise<NightlyResult<string>>;
    removeSponsoredAccount(session: string, discordUserId: string): Promise<NightlyResult<null>>;
};

export const NIGHTLY_WEBSITE_KEY_HEADER = "x-nightly-website-key";
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
const SPONSOR_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const DISCORD_AUTHORIZE_ORIGIN = "https://discord.com";
const DISCORD_AUTHORIZE_PATHS = new Set(["/oauth2/authorize", "/api/oauth2/authorize", "/api/v10/oauth2/authorize"]);

/** Decodes a success body; undefined marks a body that does not match the contract. */
type Decoder<T> = (body: unknown) => T | undefined;

/** Builds the typed Edge Function client; fetch and config are injected so tests never touch the network. */
export function createNightlyClient(config: NightlyConfig | null, fetcher: NightlyFetch): NightlyClient {
    const call = <T>(path: string, body: unknown, decode: Decoder<T>) => callFunction(config, fetcher, path, body, decode);
    return {
        startDeviceOAuth: (userCode) => call("/oauth/start", { purpose: "device", user_code: userCode }, decodeAuthorizeUrl),
        startSponsorOAuth: () => call("/oauth/start", { purpose: "sponsor-portal" }, decodeAuthorizeUrl),
        completeOAuth: (code, state) => call("/oauth/complete", { code, state }, decodeOAuthOutcome),
        claimSponsorship: (deviceId, sponsorCode) =>
            call("/sponsorship/claim", { device_id: deviceId, sponsor_code: sponsorCode }, decodeSponsoredApproval),
        sponsorPortal: (session) => call("/sponsor/portal", { session }, decodePortal),
        createSponsorCode: (session) => call("/sponsor/code", { session }, decodeSponsorCode),
        removeSponsoredAccount: (session, discordUserId) =>
            call("/sponsor/remove", { session, discord_user_id: discordUserId }, decodeEmpty),
    };
}

/** Sends one authenticated JSON POST and turns the reply into a result without ever exposing the raw body. */
async function callFunction<T>(
    config: NightlyConfig | null,
    fetcher: NightlyFetch,
    path: string,
    body: unknown,
    decode: Decoder<T>,
): Promise<NightlyResult<T>> {
    if (config === null) return failure(0, "not_configured");
    let response: Response;
    try {
        response = await fetcher(`${config.functionUrl}${path}`, {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                [NIGHTLY_WEBSITE_KEY_HEADER]: config.websiteKey,
            },
            body: JSON.stringify(body),
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
        });
    } catch {
        return failure(0, "unavailable");
    }
    const parsed = await readJson(response);
    if (!response.ok) return failure(response.status, errorCode(parsed, response.status));
    const value = decode(parsed);
    if (value === undefined) return failure(response.status, "invalid_response");
    return { ok: true, value };
}

/** Parses a bounded JSON body; empty, oversized or malformed bodies read as undefined. */
async function readJson(response: Response): Promise<unknown> {
    let text: string;
    try {
        text = await response.text();
    } catch {
        return undefined;
    }
    if (text.length === 0 || text.length > MAXIMUM_RESPONSE_BYTES) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** Extracts the contract's `{error}` code, falling back to a status-derived code for anything unexpected. */
function errorCode(body: unknown, status: number): string {
    const code = isRecord(body) ? body.error : undefined;
    if (typeof code === "string" && ERROR_CODE_PATTERN.test(code)) return code;
    return `http_${status}`;
}

/** Creates a failure result. */
function failure(status: number, code: string): NightlyFailure {
    return { ok: false, status, code };
}

/** Narrows unknown JSON to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts only a Discord authorize URL, so a compromised upstream cannot turn activation into an open redirect. */
export function decodeAuthorizeUrl(body: unknown): string | undefined {
    if (!isRecord(body) || typeof body.authorize_url !== "string") return undefined;
    let url: URL;
    try {
        url = new URL(body.authorize_url);
    } catch {
        return undefined;
    }
    if (url.origin !== DISCORD_AUTHORIZE_ORIGIN || url.username || url.password) return undefined;
    if (!DISCORD_AUTHORIZE_PATHS.has(url.pathname)) return undefined;
    return url.href;
}

/** Validates the four `/oauth/complete` outcomes listed in the contract. */
export function decodeOAuthOutcome(body: unknown): OAuthOutcome | undefined {
    if (!isRecord(body)) return undefined;
    if (body.outcome === "approved" || body.outcome === "sponsored-approved") return { outcome: body.outcome };
    if (body.outcome === "portal") return decodePortalOutcome(body);
    if (body.outcome === "needs-sponsor") return decodeNeedsSponsor(body);
    return undefined;
}

/** Validates a sponsor-portal login outcome. */
function decodePortalOutcome(body: Record<string, unknown>): OAuthOutcome | undefined {
    if (typeof body.session !== "string" || !SESSION_TOKEN_PATTERN.test(body.session)) return undefined;
    const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 86_400;
    return { outcome: "portal", session: body.session, expires_in: Math.floor(expiresIn) };
}

/** Validates a needs-sponsor outcome, bounding the identifiers carried to the claim form. */
function decodeNeedsSponsor(body: Record<string, unknown>): OAuthOutcome | undefined {
    if (typeof body.device_id !== "string" || !DEVICE_ID_PATTERN.test(body.device_id)) return undefined;
    if (typeof body.username !== "string" || body.username.length === 0 || body.username.length > 100) return undefined;
    return {
        outcome: "needs-sponsor",
        device_id: body.device_id,
        username: body.username,
        previous_sponsor_revoked: body.previous_sponsor_revoked === true,
    };
}

/** Validates the claim success body. */
function decodeSponsoredApproval(body: unknown): null | undefined {
    return isRecord(body) && body.outcome === "sponsored-approved" ? null : undefined;
}

/** Validates the portal body, dropping malformed seats rather than rendering them. */
export function decodePortal(body: unknown): SponsorPortalData | undefined {
    if (!isRecord(body) || !Array.isArray(body.seats)) return undefined;
    if (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 0) return undefined;
    const seats = body.seats.flatMap((seat): SponsorSeat[] => {
        if (!isRecord(seat) || typeof seat.discord_user_id !== "string") return [];
        if (!DISCORD_SNOWFLAKE_PATTERN.test(seat.discord_user_id)) return [];
        return [{ discordUserId: seat.discord_user_id, createdAt: seatDate(seat.created_at) }];
    });
    return { seats, limit: body.limit };
}

/** Reads a seat timestamp given as Unix seconds or an ISO string. */
function seatDate(value: unknown): Date | null {
    const date = typeof value === "number" ? new Date(value * 1000) : typeof value === "string" ? new Date(value) : null;
    if (date === null || Number.isNaN(date.getTime())) return null;
    return date;
}

/** Validates the freshly created sponsor code. */
function decodeSponsorCode(body: unknown): string | undefined {
    if (!isRecord(body) || typeof body.code !== "string" || !SPONSOR_CODE_PATTERN.test(body.code)) return undefined;
    return body.code;
}

/** Accepts the `204` (or any empty success) of a removal. */
function decodeEmpty(): null {
    return null;
}
