import { readBoundedBytes, RequestTooLargeError } from "../edge-http.ts";
import { GatewayError, type UpstreamFailure } from "./http.ts";
import {
    DISCORD_GUILD_ID,
    DISCORD_OAUTH_SCOPES,
    DISCORD_REDIRECT_URI,
    DISCORD_USER_AGENT,
    isDiscordSnowflake,
} from "./policy.ts";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = `${DISCORD_API}/oauth2/token`;
/** Largest OAuth token-exchange body read from Discord. */
const MAXIMUM_TOKEN_RESPONSE_BYTES = 16 * 1024;
/** Largest user or guild-member body read from Discord's REST API. */
const MAXIMUM_MEMBER_RESPONSE_BYTES = 64 * 1024;

export type DiscordUser = { id: string; username: string };
export type DiscordMember = { roles: string[]; user?: DiscordUser };
export type DiscordCredentials = { clientId: string; clientSecret: string; botToken: string };

/** A successful token exchange carrying the gateway's scopes. */
type BearerToken = { token_type: "Bearer"; access_token: string; scope: string };

/** A Discord response together with its bounded, strictly decoded body. */
type DiscordReply = { response: Response; text: string };

/** The Discord calls the gateway makes: OAuth for the signed-in user and the bot's member lookup. */
export interface DiscordApi {
    authorizeUrl(state: string): string;
    exchangeCode(code: string): Promise<string>;
    currentUser(accessToken: string): Promise<DiscordUser>;
    currentMember(accessToken: string): Promise<DiscordMember>;
    currentMemberIfPresent(accessToken: string): Promise<DiscordMember | null>;
    botGuildMember(userId: string): Promise<DiscordMember | null>;
}

/** Creates the Discord client over an injected fetch, mapping upstream failures to gateway errors. */
export function createDiscordApi(credentials: DiscordCredentials, fetchImplementation: typeof fetch): DiscordApi {
    return new DiscordHttpApi(credentials, fetchImplementation);
}

// Talks to Discord's REST API with the application's credentials and the DiscordBot user agent.
class DiscordHttpApi implements DiscordApi {
    constructor(private readonly credentials: DiscordCredentials, private readonly fetchImplementation: typeof fetch) {}

    /** Builds the consent URL for the website's fixed callback and the gateway's scopes. */
    authorizeUrl(state: string): string {
        const url = new URL(DISCORD_AUTHORIZE);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", this.credentials.clientId);
        url.searchParams.set("scope", DISCORD_OAUTH_SCOPES);
        url.searchParams.set("state", state);
        url.searchParams.set("redirect_uri", DISCORD_REDIRECT_URI);
        url.searchParams.set("prompt", "consent");
        return url.toString();
    }

    /** Exchanges an authorization code for a user access token; the refresh token is discarded. */
    async exchangeCode(code: string): Promise<string> {
        const form = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: DISCORD_REDIRECT_URI,
            client_id: this.credentials.clientId,
            client_secret: this.credentials.clientSecret,
        });
        const response = await this.fetchImplementation(DISCORD_TOKEN, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": DISCORD_USER_AGENT },
            body: form,
        });
        const text = await readDiscordText(response, MAXIMUM_TOKEN_RESPONSE_BYTES);
        if (!response.ok) throw new GatewayError(502, "discord_authorization_failed", discordFailure(response, text));
        const token = parseJson(text);
        if (!isBearerWithRequiredScopes(token)) throw new GatewayError(502, "discord_response_invalid");
        return token.access_token;
    }

    /** Reads the signed-in user, requiring a snowflake ID. */
    async currentUser(accessToken: string): Promise<DiscordUser> {
        const user = await this.userGet<Partial<DiscordUser> | null>("/users/@me", accessToken);
        if (user === null || !isDiscordSnowflake(user.id)) throw new GatewayError(502, "discord_response_invalid");
        return { id: user.id, username: typeof user.username === "string" ? user.username : "" };
    }

    /** Reads the signed-in user's guild membership; not being in the guild is `403 discord_membership_required`. */
    async currentMember(accessToken: string): Promise<DiscordMember> {
        return requireRoles(await this.userGet<unknown>(this.memberPath(), accessToken));
    }

    /** Reads the signed-in user's guild membership, or null when they are not in the guild. */
    async currentMemberIfPresent(accessToken: string): Promise<DiscordMember | null> {
        const member = await this.userGetIfPresent<unknown>(this.memberPath(), accessToken);
        if (member === null) return null;
        return requireRoles(member);
    }

    /** Looks up any guild member with the bot token, or null when they are not in the guild. */
    async botGuildMember(userId: string): Promise<DiscordMember | null> {
        const response = await this.fetchImplementation(`${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/members/${userId}`, {
            headers: { authorization: `Bot ${this.credentials.botToken}`, "user-agent": DISCORD_USER_AGENT },
        });
        const text = await readDiscordText(response, MAXIMUM_MEMBER_RESPONSE_BYTES);
        if (response.status === 404) return null;
        if (!response.ok) throw new GatewayError(502, "discord_membership_required", discordFailure(response, text));
        return requireRoles(parseJson(text));
    }

    /** The current-user guild-member path for the Bannerlord Coop guild. */
    private memberPath(): string {
        return `/users/@me/guilds/${DISCORD_GUILD_ID}/member`;
    }

    /** GETs a user-token endpoint; every failure, a 404 included, is a gateway error. */
    private async userGet<T>(path: string, accessToken: string): Promise<T> {
        return parseUserReply(await this.userFetch(path, accessToken)) as T;
    }

    /** GETs a user-token endpoint, or null when Discord answers 404; other failures are gateway errors. */
    private async userGetIfPresent<T>(path: string, accessToken: string): Promise<T | null> {
        const reply = await this.userFetch(path, accessToken);
        if (reply.response.status === 404) return null;
        return parseUserReply(reply) as T;
    }

    /** Sends a user-token GET and reads its bounded body. */
    private async userFetch(path: string, accessToken: string): Promise<DiscordReply> {
        const response = await this.fetchImplementation(`${DISCORD_API}${path}`, {
            headers: { authorization: `Bearer ${accessToken}`, "user-agent": DISCORD_USER_AGENT },
        });
        return { response, text: await readDiscordText(response, MAXIMUM_MEMBER_RESPONSE_BYTES) };
    }
}

/** Parses a successful user-token reply; a failed one is `discord_membership_required` with Discord's codes. */
function parseUserReply({ response, text }: DiscordReply): unknown {
    if (response.ok) return parseJson(text);
    throw new GatewayError(membershipFailureStatus(response), "discord_membership_required", discordFailure(response, text));
}

/** A 404 means the user is not a guild member (`403`); any other Discord failure is upstream (`502`). */
function membershipFailureStatus(response: Response): number {
    if (response.status === 404) return 403;
    return 502;
}

/**
 * Reads a bounded Discord body as strict UTF-8: oversized is `502 response_too_large`, undecodable
 * `502 discord_response_invalid`, and a network fault mid-body propagates as an unexpected error.
 */
async function readDiscordText(response: Response, maximumBytes: number): Promise<string> {
    const bytes = await readBoundedBytes(response, maximumBytes).catch(rethrowTooLargeAsResponseTooLarge);
    return decodeStrictUtf8(bytes);
}

/** Maps an over-limit Discord body to `502 response_too_large` and rethrows anything else unchanged. */
function rethrowTooLargeAsResponseTooLarge(error: unknown): never {
    if (error instanceof RequestTooLargeError) throw new GatewayError(502, "response_too_large");
    throw error;
}

/** Decodes a Discord body as strict UTF-8, treating invalid bytes as an invalid upstream response. */
function decodeStrictUtf8(bytes: Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw new GatewayError(502, "discord_response_invalid");
    }
}

/** Extracts Discord's HTTP status and numeric JSON error code (e.g. 40333, 10007) from a failed response body. */
function discordFailure(response: Response, text: string): UpstreamFailure {
    try {
        const code = (JSON.parse(text) as { code?: unknown }).code;
        if (Number.isSafeInteger(code)) return { upstream_status: response.status, upstream_code: code as number };
    } catch {
        // Non-JSON bodies (e.g. Cloudflare error pages) carry only the status.
    }
    return { upstream_status: response.status };
}

/** Whether a token-exchange payload is a Bearer token granted every scope the gateway asks for. */
function isBearerWithRequiredScopes(value: unknown): value is BearerToken {
    if (typeof value !== "object" || value === null) return false;
    const { token_type: tokenType, access_token: accessToken, scope } = value as Record<string, unknown>;
    return tokenType === "Bearer" && typeof accessToken === "string" && typeof scope === "string" && hasRequiredScopes(scope);
}

/** Whether a granted scope string includes every scope the gateway asks for. */
function hasRequiredScopes(granted: string): boolean {
    const scopes = granted.split(" ");
    return DISCORD_OAUTH_SCOPES.split(" ").every((scope) => scopes.includes(scope));
}

/** Rejects a member payload that is not an object with a roles array. */
function requireRoles(member: unknown): DiscordMember {
    if (typeof member !== "object" || member === null || !Array.isArray((member as DiscordMember).roles)) {
        throw new GatewayError(502, "discord_response_invalid");
    }
    return member as DiscordMember;
}

/** Parses a Discord success body, treating malformed JSON as an invalid upstream response. */
function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        throw new GatewayError(502, "discord_response_invalid");
    }
}
