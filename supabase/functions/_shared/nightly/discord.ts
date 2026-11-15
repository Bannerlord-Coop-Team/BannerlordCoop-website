import { discordFailure, GatewayError, readUpstreamText } from "./http.ts";
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

export type DiscordUser = { id: string; username: string };
export type DiscordMember = { roles: string[]; user?: DiscordUser };
export type DiscordCredentials = { clientId: string; clientSecret: string; botToken: string };

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
        const text = await readUpstreamText(response, 16 * 1024);
        if (!response.ok) throw new GatewayError(502, "discord_authorization_failed", discordFailure(response, text));
        const value = parseJson(text) as { token_type?: unknown; access_token?: unknown; scope?: unknown };
        if (value.token_type !== "Bearer" || typeof value.access_token !== "string" || typeof value.scope !== "string"
            || !hasRequiredScopes(value.scope)) {
            throw new GatewayError(502, "discord_response_invalid");
        }
        return value.access_token;
    }

    /** Reads the signed-in user, requiring a snowflake ID. */
    async currentUser(accessToken: string): Promise<DiscordUser> {
        const user = await this.userGet<Partial<DiscordUser>>("/users/@me", accessToken, false);
        if (user === null || !isDiscordSnowflake(user.id)) throw new GatewayError(502, "discord_response_invalid");
        return { id: user.id, username: typeof user.username === "string" ? user.username : "" };
    }

    /** Reads the signed-in user's guild membership; not being in the guild is `403 discord_membership_required`. */
    async currentMember(accessToken: string): Promise<DiscordMember> {
        return requireRoles(await this.userGet<unknown>(this.memberPath(), accessToken, false));
    }

    /** Reads the signed-in user's guild membership, or null when they are not in the guild. */
    async currentMemberIfPresent(accessToken: string): Promise<DiscordMember | null> {
        const member = await this.userGet<unknown>(this.memberPath(), accessToken, true);
        return member === null ? null : requireRoles(member);
    }

    /** Looks up any guild member with the bot token, or null when they are not in the guild. */
    async botGuildMember(userId: string): Promise<DiscordMember | null> {
        const response = await this.fetchImplementation(`${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/members/${userId}`, {
            headers: { authorization: `Bot ${this.credentials.botToken}`, "user-agent": DISCORD_USER_AGENT },
        });
        const text = await readUpstreamText(response, 64 * 1024);
        if (response.status === 404) return null;
        if (!response.ok) throw new GatewayError(502, "discord_membership_required", discordFailure(response, text));
        return requireRoles(parseJson(text));
    }

    /** The current-user guild-member path for the Bannerlord Coop guild. */
    private memberPath(): string {
        return `/users/@me/guilds/${DISCORD_GUILD_ID}/member`;
    }

    /** GETs a user-token endpoint; a 404 is null when allowed, otherwise `403`, and other failures `502`. */
    private async userGet<T>(path: string, accessToken: string, allowNotFound: boolean): Promise<T | null> {
        const response = await this.fetchImplementation(`${DISCORD_API}${path}`, {
            headers: { authorization: `Bearer ${accessToken}`, "user-agent": DISCORD_USER_AGENT },
        });
        const text = await readUpstreamText(response, 64 * 1024);
        if (allowNotFound && response.status === 404) return null;
        if (!response.ok) {
            throw new GatewayError(response.status === 404 ? 403 : 502, "discord_membership_required", discordFailure(response, text));
        }
        return parseJson(text) as T;
    }
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
