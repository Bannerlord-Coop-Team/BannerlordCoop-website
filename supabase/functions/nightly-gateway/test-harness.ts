import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { postgresGatewayDatabase } from "../_shared/nightly/database.ts";
import { createNightlyGatewayHandler } from "../_shared/nightly/gateway.ts";
import { DISCORD_GUILD_ID } from "../_shared/nightly/policy.ts";
import { sha256 } from "../_shared/nightly/tokens.ts";

// Shared fixtures for the nightly-gateway Edge Function tests: an in-process PostgreSQL with the
// real gateway migrations, a scripted Discord, and request builders for both route families.

export const NOW = 1_800_000_000;
export const WEBSITE_KEY = "w".repeat(48);
export const GATEWAY = "https://nightly.bannerlordcoop.com";
export const LEGACY_GATEWAY = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
export const CLIENT_ID = "1537575576745803799";
export const BOT_TOKEN = "B".repeat(59);
export const PATREON_ROLE = "1532151760012050452";
export const COMPETITION_WINNER_ROLE = "1551834978570997792";
export const SPONSOR = "987654321098765432";
export const OTHER_SPONSOR = "876543210987654321";
export const FRIEND = "123456789012345678";
export const TOKEN_URL = "https://discord.com/api/v10/oauth2/token";

const MIGRATIONS = [
    "202608260004_create_nightly_gateway_schema",
    "202608260005_enforce_nightly_sponsorship_limit",
    "20261115090000_nightly_gateway_retire_refresh_tokens",
];
const TABLES = "device_sessions, supporter_grants, sponsorships, download_sessions, oauth_states, sponsor_sessions";

/** Creates an in-memory database with the gateway schema applied up to `migrationCount` migrations. */
export async function createGatewayDatabase(migrationCount = MIGRATIONS.length): Promise<PGlite> {
    const database = new PGlite();
    await database.exec("create role anon; create role authenticated;");
    for (const name of MIGRATIONS.slice(0, migrationCount)) await applyMigration(database, name);
    return database;
}

/** Applies one migration file from supabase/migrations by name. */
export async function applyMigration(database: PGlite, name: string): Promise<void> {
    await database.exec(await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8"));
}

/** Empties every gateway table between tests. */
export async function clearGatewayTables(database: PGlite): Promise<void> {
    await database.exec(`truncate ${TABLES.split(", ").map((table) => `nightly_gateway.${table}`).join(", ")} cascade`);
}

/** The scripted Discord: who signs in, their guild membership, and the bot's view of each sponsor. */
export type DiscordScript = {
    user: { id: string; username: string };
    /** The signed-in user's guild member; null is "not in the guild". */
    member: { roles: string[] } | null;
    /** Bot lookups by user ID; absent IDs are not in the guild. */
    bot: Record<string, { roles: string[] }>;
    tokenFailure?: () => Response;
    botFailure?: () => Response;
    calls: Array<{ url: string; headers: Headers; body: string }>;
};

/** Builds a Discord script defaulting to an unaffiliated friend who is not in the guild. */
export function discordScript(overrides: Partial<DiscordScript> = {}): DiscordScript {
    return { user: { id: FRIEND, username: "Sponsored Friend" }, member: null, bot: {}, calls: [], ...overrides };
}

/** A fetch that answers exactly the Discord endpoints the gateway calls, recording every call. */
export function discordFetch(script: DiscordScript): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        script.calls.push({ url, headers: new Headers(init?.headers), body: String(init?.body ?? "") });
        if (url === TOKEN_URL) return script.tokenFailure?.() ?? Response.json({
            access_token: "user-access-token",
            refresh_token: "refresh-token-never-stored",
            expires_in: 604800,
            scope: "identify guilds.members.read",
            token_type: "Bearer",
        });
        if (url === "https://discord.com/api/v10/users/@me") return Response.json(script.user);
        if (url === `https://discord.com/api/v10/users/@me/guilds/${DISCORD_GUILD_ID}/member`) {
            return script.member === null ? unknownMember() : Response.json(script.member);
        }
        const botLookup = url.match(new RegExp(`^https://discord\\.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/(\\d+)$`));
        if (botLookup !== null) {
            if (script.botFailure) return script.botFailure();
            const member = script.bot[botLookup[1]!];
            return member === undefined ? unknownMember() : Response.json(member);
        }
        throw new Error(`Unexpected Discord request: ${url}`);
    }) as typeof fetch;
}

/** Discord's 404 body for a user who is not in the guild. */
export function unknownMember(): Response {
    return Response.json({ message: "Unknown Member", code: 10007 }, { status: 404 });
}

/** A handler over the shared database and a Discord script, plus its logs and lease releases. */
export function gatewayHandler(database: PGlite, script: DiscordScript, clock = () => NOW * 1000) {
    const releases: boolean[] = [];
    const logs: Record<string, unknown>[] = [];
    const handler = createNightlyGatewayHandler({
        websiteKey: WEBSITE_KEY,
        discord: { clientId: CLIENT_ID, clientSecret: "s".repeat(32), botToken: BOT_TOKEN },
        fetch: discordFetch(script),
        openDatabase: async () => ({
            database: postgresGatewayDatabase(database),
            release: (failed: boolean) => { releases.push(failed); },
        }),
        clock,
        log: (event) => logs.push(event),
    });
    return { handler, releases, logs };
}

/** An installer request as the Worker forwards it, with the forwarded-origin header. */
export function installerRequest(path: string, form = "", origin: string | null = GATEWAY): Request {
    const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
    if (origin !== null) headers.set("x-nightly-forwarded-origin", origin);
    return new Request(`https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/nightly-gateway${path}`, {
        method: "POST", headers, body: form,
    });
}

/** A website request with the shared key and a JSON body, addressed by the runtime's function-relative path. */
export function websiteRequest(path: string, body: unknown, key: string | null = WEBSITE_KEY): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (key !== null) headers.set("x-nightly-website-key", key);
    return new Request(`http://localhost/nightly-gateway${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

/** Seeds a device session and returns its plaintext secret, user code and OAuth state. */
export async function seedDevice(database: PGlite, options: {
    status?: string;
    discordUserId?: string | null;
    sponsorId?: string | null;
    expiresAt?: number;
    suffix?: string;
} = {}) {
    const suffix = options.suffix ?? "A";
    const id = `00000000-0000-4000-8000-${suffix.charCodeAt(0).toString(16).padStart(12, "0")}`;
    const secret = suffix.repeat(43);
    const state = `s${suffix.repeat(42)}`;
    const userCode = `ABCD-${suffix.repeat(4)}`;
    await database.query(
        `insert into nightly_gateway.device_sessions
            (id, device_secret_hash, user_code, status, discord_user_id, sponsor_discord_user_id, oauth_state_hash, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, await sha256(secret), userCode, options.status ?? "pending", options.discordUserId ?? null,
            options.sponsorId ?? null, await sha256(state), NOW - 60, options.expiresAt ?? NOW + 540],
    );
    return { id, secret, state, userCode };
}

/** Seeds a supporter grant, optionally with a sponsor code. */
export async function seedGrant(database: PGlite, supporterId: string, sponsorCode?: string): Promise<void> {
    await database.query(
        "insert into nightly_gateway.supporter_grants (supporter_discord_user_id, sponsor_code_hash, updated_at) values ($1, $2, $3)",
        [supporterId, sponsorCode === undefined ? null : await sha256(sponsorCode), NOW - 100],
    );
}

/** Seeds one sponsored seat. */
export async function seedSeat(database: PGlite, supporterId: string, friendId: string, createdAt = NOW - 50): Promise<void> {
    await database.query(
        "insert into nightly_gateway.sponsorships (supporter_discord_user_id, sponsored_discord_user_id, created_at) values ($1, $2, $3)",
        [supporterId, friendId, createdAt],
    );
}

/** Seeds a download session for a friend under a sponsor. */
export async function seedDownloadSession(database: PGlite, friendId: string, supporterId: string, token = "d".repeat(43)) {
    await database.query(
        `insert into nightly_gateway.download_sessions
            (token_hash, device_session_id, discord_user_id, supporter_discord_user_id, created_at, expires_at)
         values ($1, null, $2, $3, $4, $5)`,
        [await sha256(token), friendId, supporterId, NOW - 10, NOW + 3000],
    );
}

/** Seeds a sponsor-portal session and returns its plaintext token. */
export async function seedSponsorSession(database: PGlite, supporterId: string, expiresAt = NOW + 3600, token = "p".repeat(43)) {
    await database.query(
        "insert into nightly_gateway.sponsor_sessions (token_hash, supporter_discord_user_id, created_at, expires_at) values ($1, $2, $3, $4)",
        [await sha256(token), supporterId, NOW - 10, expiresAt],
    );
    return token;
}

/** Seeds a live sponsor-portal OAuth state and returns its plaintext. */
export async function seedPortalState(database: PGlite, state = "q".repeat(43), expiresAt = NOW + 300): Promise<string> {
    await database.query(
        "insert into nightly_gateway.oauth_states (state_hash, purpose, created_at, expires_at) values ($1, 'sponsor-portal', $2, $3)",
        [await sha256(state), NOW - 10, expiresAt],
    );
    return state;
}

/** Runs one query and returns its rows. */
export async function rows<T>(database: PGlite, sql: string, values: unknown[] = []): Promise<T[]> {
    return (await database.query<T>(sql, values)).rows;
}

/** Reads a response's JSON body. */
export async function body(response: Response): Promise<Record<string, unknown>> {
    return await response.json() as Record<string, unknown>;
}
