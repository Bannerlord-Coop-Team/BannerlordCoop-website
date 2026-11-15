import {
    DEVICE_ID_PATTERN,
    DISCORD_SNOWFLAKE_PATTERN,
    SPONSOR_CODE_PATTERN,
    WEBSITE_KEY_HEADER,
} from "../../../../supabase/functions/_shared/nightly/formats";
import type { NightlyConfig } from "./config";
import type { ClaimContext } from "./cookies";
import { reportFailed, reportInvalidResponse, reportUnreachable, type NightlyLogger } from "./diagnostics";
import { ERROR_CODE_PATTERN, isValidUsername, SESSION_TOKEN_PATTERN } from "./formats";

/** A failed Edge Function call: HTTP status (0 when no response arrived) and a sanitized error code. */
export type NightlyFailure = { ok: false; status: number; code: string };
export type NightlyResult<T> = { ok: true; value: T } | NightlyFailure;

export type OAuthOutcome =
    | { outcome: "approved" }
    | { outcome: "sponsored-approved" }
    | { outcome: "needs-sponsor"; claim: ClaimContext }
    | { outcome: "portal"; session: string; expires_in: number };

export type SponsorSeat = { discordUserId: string; createdAt: Date | null };
export type SponsorPortalData = { seats: SponsorSeat[] };

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

const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const SERVER_ERROR_STATUS = 500;
const DISCORD_AUTHORIZE_ORIGIN = "https://discord.com";
const DISCORD_AUTHORIZE_PATHS = new Set(["/oauth2/authorize", "/api/oauth2/authorize", "/api/v10/oauth2/authorize"]);

/** Decodes a success body; undefined marks a body that does not match the contract. */
type Decoder<T> = (body: unknown) => T | undefined;
/** The injected dependencies one call runs against. */
type Transport = { config: NightlyConfig; fetcher: NightlyFetch; log: NightlyLogger };
/** A response body: parsed JSON (undefined when empty, oversized or malformed), or unreadable when the stream failed. */
type BodyRead = { readable: true; body: unknown } | { readable: false };

/** Builds the typed Edge Function client; fetch, config and logging are injected so tests never touch the network. */
export function createNightlyClient(
    config: NightlyConfig | null,
    fetcher: NightlyFetch,
    log: NightlyLogger = ignoreLog,
): NightlyClient {
    const call = <T>(path: string, body: unknown, decode: Decoder<T>): Promise<NightlyResult<T>> => {
        if (config === null) return Promise.resolve(failure(0, "not_configured"));
        return callFunction({ config, fetcher, log }, path, body, decode);
    };
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

/** Sends one call and turns the reply into a result, logging each failure once and never exposing the raw body. */
async function callFunction<T>(transport: Transport, path: string, body: unknown, decode: Decoder<T>): Promise<NightlyResult<T>> {
    const { log } = transport;
    let response: Response;
    try {
        response = await post(transport, path, body);
    } catch (error) {
        reportUnreachable(log, path, error);
        return failure(0, "unavailable");
    }
    const read = await readJson(response);
    if (!response.ok) {
        const code = errorCode(read.readable ? read.body : undefined, response.status);
        if (response.status >= SERVER_ERROR_STATUS) reportFailed(log, path, response.status, code);
        return failure(response.status, code);
    }
    const value = read.readable ? decode(read.body) : undefined;
    if (value === undefined) {
        reportInvalidResponse(log, path);
        return failure(response.status, "invalid_response");
    }
    return { ok: true, value };
}

/** Sends the authenticated JSON POST to one contract route. */
function post({ config, fetcher }: Transport, path: string, body: unknown): Promise<Response> {
    return fetcher(`${config.functionUrl}${path}`, {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            [WEBSITE_KEY_HEADER]: config.websiteKey,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
}

/** Reads a response body; a stream that fails is reported as unreadable rather than read as empty. */
async function readJson(response: Response): Promise<BodyRead> {
    let text: string;
    try {
        text = await response.text();
    } catch {
        return { readable: false };
    }
    return { readable: true, body: parseBoundedJson(text) };
}

/** Parses JSON text; empty, oversized or malformed text reads as undefined. */
function parseBoundedJson(text: string): unknown {
    if (text.length === 0 || text.length > MAXIMUM_RESPONSE_BYTES) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** The default logger: drops every entry. */
function ignoreLog(): void {}

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

/** Validates a sponsor-portal login outcome; the session lifetime must be a positive whole number of seconds. */
function decodePortalOutcome(body: Record<string, unknown>): OAuthOutcome | undefined {
    if (typeof body.session !== "string" || !SESSION_TOKEN_PATTERN.test(body.session)) return undefined;
    if (typeof body.expires_in !== "number") return undefined;
    const expiresIn = Math.floor(body.expires_in);
    if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0) return undefined;
    return { outcome: "portal", session: body.session, expires_in: expiresIn };
}

/** Validates a needs-sponsor outcome into the claim context the claim cookie carries to the claim form. */
function decodeNeedsSponsor(body: Record<string, unknown>): OAuthOutcome | undefined {
    if (typeof body.device_id !== "string" || !DEVICE_ID_PATTERN.test(body.device_id)) return undefined;
    if (!isValidUsername(body.username)) return undefined;
    const previousSponsorRevoked = body.previous_sponsor_revoked === true;
    return { outcome: "needs-sponsor", claim: { deviceId: body.device_id, username: body.username, previousSponsorRevoked } };
}

/** Validates the claim success body. */
function decodeSponsoredApproval(body: unknown): null | undefined {
    return isRecord(body) && body.outcome === "sponsored-approved" ? null : undefined;
}

/** Validates the portal body, dropping malformed seats rather than rendering them. */
export function decodePortal(body: unknown): SponsorPortalData | undefined {
    if (!isRecord(body) || !Array.isArray(body.seats)) return undefined;
    const seats = body.seats.flatMap((seat): SponsorSeat[] => {
        if (!isRecord(seat) || typeof seat.discord_user_id !== "string") return [];
        if (!DISCORD_SNOWFLAKE_PATTERN.test(seat.discord_user_id)) return [];
        return [{ discordUserId: seat.discord_user_id, createdAt: seatDate(seat.created_at) }];
    });
    return { seats };
}

/** Reads a seat timestamp sent as Unix seconds; anything else, or an out-of-range value, reads as unknown. */
function seatDate(value: unknown): Date | null {
    if (typeof value !== "number") return null;
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) return null;
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
