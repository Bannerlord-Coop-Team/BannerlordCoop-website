import { boundedJson, record } from "./membership.ts";

// Creator access tokens expire roughly monthly and the refresh token rotates on every use, so the
// current pair lives in Supabase Vault behind a service-role-only RPC rather than in function
// secrets. Function secrets only bootstrap the store; after the first rotation they are stale.

export const PATREON_TOKEN_URL = "https://www.patreon.com/api/oauth2/token";
const TOKEN = /^[\x21-\x7e]{16,4096}$/u;
const MAX_EXPIRES_IN = 366 * 86_400;
const CACHE_MS = 30_000;

export type CreatorTokenOperation = "read" | "seed" | "refresh_begin" | "refresh_commit" | "refresh_failed";
export type CreatorTokenRpc = (operation: CreatorTokenOperation, input: Record<string, unknown>) => Promise<unknown>;

export interface CreatorTokenProvider {
    /** Current access token, rotated ahead of expiry when a refresh token is stored. */
    current(): Promise<string>;
    /** Replacement after Patreon rejected `rejected`, or null when none is available right now. */
    replace(rejected: string): Promise<string | null>;
}

export function isCreatorToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN.test(value);
}

/** Fixed token without rotation: tests and deployments that only set the access-token secret. */
export function staticCreatorToken(token: string): CreatorTokenProvider {
    if (!isCreatorToken(token)) throw new Error("invalid_creator_token");
    return { current: async () => token, replace: async () => null };
}

export interface CreatorTokenProviderOptions {
    clientId: string;
    clientSecret: string;
    /** Function secrets that seed the store and serve as a last resort while the store is unreachable. */
    bootstrap: { accessToken: string; refreshToken: string };
    rpc: CreatorTokenRpc;
    fetchImplementation?: typeof fetch;
    now?: () => number;
    log?: (message: string) => void;
}

type ReadState = { configured: false } | { configured: true; accessToken: string; generation: number; refreshDue: boolean };

function readState(value: unknown): ReadState {
    if (!record(value) || typeof value.configured !== "boolean") throw new Error("invalid_creator_token_state");
    if (!value.configured) return { configured: false };
    if (!isCreatorToken(value.accessToken) || !Number.isSafeInteger(value.generation) || Number(value.generation) < 1
        || typeof value.refreshDue !== "boolean") throw new Error("invalid_creator_token_state");
    return { configured: true, accessToken: value.accessToken, generation: Number(value.generation), refreshDue: value.refreshDue };
}

export function createCreatorTokenProvider(options: CreatorTokenProviderOptions): CreatorTokenProvider {
    const { bootstrap } = options;
    if (!isCreatorToken(bootstrap.accessToken) || !isCreatorToken(bootstrap.refreshToken) || bootstrap.accessToken === bootstrap.refreshToken) {
        throw new Error("invalid_creator_token_bootstrap");
    }
    if (!options.clientId || !options.clientSecret || options.clientId === options.clientSecret) throw new Error("invalid_patreon_client");
    const fetcher = options.fetchImplementation ?? fetch;
    const now = options.now ?? Date.now;
    // Fixed messages only: never tokens, response bodies or exception text.
    const log = options.log ?? ((message: string) => console.warn(message));
    let cached: { accessToken: string; until: number } | null = null;

    async function read(): Promise<ReadState> {
        return readState(await options.rpc("read", {}));
    }

    async function seeded(): Promise<ReadState & { configured: true }> {
        let state = await read();
        if (state.configured) return state;
        // Another worker may seed concurrently; the store keeps the first pair and the re-read decides.
        try { await options.rpc("seed", { accessToken: bootstrap.accessToken, refreshToken: bootstrap.refreshToken }); }
        catch { /* re-read decides */ }
        state = await read();
        if (!state.configured) throw new Error("creator_token_unavailable");
        return state;
    }

    async function recordFailure(generation: number, reason: "rejected" | "unavailable") {
        log(reason === "rejected" ? "Patreon creator token refresh rejected" : "Patreon creator token refresh unavailable");
        try { await options.rpc("refresh_failed", { generation, reason }); } catch { /* the lease expires on its own */ }
    }

    /** Rotates the stored pair under the store's short lease; returns the new access token or null. */
    async function refresh(generation: number): Promise<string | null> {
        const begun = await options.rpc("refresh_begin", { generation });
        if (!record(begun) || begun.busy === true || begun.stale === true || !isCreatorToken(begun.refreshToken)
            || begun.generation !== generation) return null;
        let response: Response;
        try {
            response = await fetcher(PATREON_TOKEN_URL, {
                method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
                headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "BannerlordCoop - website membership sync" },
                body: new URLSearchParams({
                    grant_type: "refresh_token", refresh_token: begun.refreshToken,
                    client_id: options.clientId, client_secret: options.clientSecret,
                }),
            });
        } catch {
            await recordFailure(generation, "unavailable");
            return null;
        }
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            await recordFailure(generation, response.status === 400 || response.status === 401 ? "rejected" : "unavailable");
            return null;
        }
        let tokens: unknown;
        try { tokens = await boundedJson(response, 16_384); }
        catch { await recordFailure(generation, "unavailable"); return null; }
        if (!record(tokens) || !isCreatorToken(tokens.access_token) || !isCreatorToken(tokens.refresh_token)
            || tokens.access_token === tokens.refresh_token || !Number.isSafeInteger(tokens.expires_in)
            || Number(tokens.expires_in) < 60 || Number(tokens.expires_in) > MAX_EXPIRES_IN) {
            await recordFailure(generation, "unavailable");
            return null;
        }
        const committed = await options.rpc("refresh_commit", {
            generation, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in,
        });
        if (!record(committed) || committed.rotated !== true) return null;
        cached = { accessToken: tokens.access_token, until: now() + CACHE_MS };
        return tokens.access_token;
    }

    return {
        async current() {
            if (cached && cached.until > now()) return cached.accessToken;
            let state: ReadState & { configured: true };
            try {
                state = await seeded();
            } catch {
                // Store or migration unavailable: keep working with the bootstrap secret.
                log("Patreon creator token store unavailable; using bootstrap token");
                return bootstrap.accessToken;
            }
            if (state.refreshDue) {
                try {
                    const rotated = await refresh(state.generation);
                    if (rotated !== null) return rotated;
                } catch { log("Patreon creator token refresh unavailable"); }
            }
            cached = { accessToken: state.accessToken, until: now() + CACHE_MS };
            return state.accessToken;
        },
        async replace(rejected) {
            cached = null;
            let state: ReadState & { configured: true };
            try { state = await seeded(); } catch { return null; }
            // Another worker may already have rotated; use its token before spending the refresh token.
            if (state.accessToken !== rejected) {
                cached = { accessToken: state.accessToken, until: now() + CACHE_MS };
                return state.accessToken;
            }
            try { return await refresh(state.generation); }
            catch { log("Patreon creator token refresh unavailable"); return null; }
        },
    };
}

/** Sends a creator-authenticated request and retries exactly once with a replacement token after a 401. */
export async function fetchWithCreatorToken(
    provider: CreatorTokenProvider, fetcher: typeof fetch, url: URL, init: RequestInit & { headers: Record<string, string> },
): Promise<Response> {
    const send = (token: string) => fetcher(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
    const token = await provider.current();
    const response = await send(token);
    if (response.status !== 401) return response;
    const replacement = await provider.replace(token);
    if (replacement === null) return response;
    await response.body?.cancel().catch(() => undefined);
    return send(replacement);
}

/** Service-role adapter for the fixed `patreon_creator_token` RPC. */
export function createCreatorTokenRpc(options: { supabaseUrl: string; serviceKey: string; fetchImplementation?: typeof fetch }): CreatorTokenRpc {
    const origin = new URL(options.supabaseUrl);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
        throw new Error("invalid_supabase_url");
    }
    if (!options.serviceKey || options.serviceKey.length < 20 || options.serviceKey.length > 4096) throw new Error("invalid_service_key");
    const endpoint = new URL("/rest/v1/rpc/patreon_creator_token", origin);
    return async (operation, input) => {
        const response = await (options.fetchImplementation ?? fetch)(endpoint, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
            headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json" },
            body: JSON.stringify({ p_operation: operation, p_input: input }),
        });
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw new Error("creator_token_rpc_failed");
        }
        return boundedJson(response, 16_384);
    };
}
