import { boundedJson, record } from "./membership.ts";

// Creator access tokens expire roughly monthly and the refresh token rotates on every use, so the
// current pair lives in Supabase Vault behind a service-role-only RPC rather than in function
// secrets. Function secrets only seed the store; after the first rotation they are stale.
//
// Invariant: creator token requests happen only under the patreon-roles sync worker lease, so at
// most one worker refreshes at a time. The store's generation fence catches anything else; it does
// not by itself prevent two callers from spending the same single-use refresh token.

export const PATREON_TOKEN_URL = "https://www.patreon.com/api/oauth2/token";
const TOKEN = /^[\x21-\x7e]{16,4096}$/u;
const MAX_EXPIRES_IN = 366 * 86_400;
const CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;

export type CreatorTokenOperation = "read" | "seed" | "rotate" | "failed";
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
    /** Function secrets that seed the store on first use. */
    bootstrap: { accessToken: string; refreshToken: string };
    rpc: CreatorTokenRpc;
    fetchImplementation?: typeof fetch;
    now?: () => number;
    log?: (message: string) => void;
}

type Stored = { accessToken: string; refreshToken: string; generation: number; refreshDue: boolean };
type ReadState = { configured: false } | ({ configured: true } & Stored);

function readState(value: unknown): ReadState {
    if (!record(value) || typeof value.configured !== "boolean") throw new Error("invalid_creator_token_state");
    if (!value.configured) return { configured: false };
    if (!isCreatorToken(value.accessToken) || !isCreatorToken(value.refreshToken) || !Number.isSafeInteger(value.generation)
        || Number(value.generation) < 1 || typeof value.refreshDue !== "boolean") throw new Error("invalid_creator_token_state");
    return { configured: true, accessToken: value.accessToken, refreshToken: value.refreshToken, generation: Number(value.generation), refreshDue: value.refreshDue };
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

    function remember(accessToken: string) {
        cached = { accessToken, until: now() + CACHE_MS };
        return accessToken;
    }

    async function read(): Promise<ReadState> {
        return readState(await options.rpc("read", {}));
    }

    /** Current stored pair, seeding from the function secrets on first use. Store failures propagate. */
    async function stored(): Promise<Stored> {
        let state = await read();
        if (state.configured) return state;
        // A concurrent seed answers `stale`, never an error; the re-read decides either way.
        await options.rpc("seed", { accessToken: bootstrap.accessToken, refreshToken: bootstrap.refreshToken });
        state = await read();
        if (!state.configured) throw new Error("creator_token_unavailable");
        return state;
    }

    async function recordFailure(generation: number, reason: "rejected" | "unavailable") {
        log(reason === "rejected" ? "Patreon creator token refresh rejected" : "Patreon creator token refresh unavailable");
        try { await options.rpc("failed", { generation, reason }); } catch { /* the failure is already logged */ }
    }

    /** Exchanges the refresh token; returns the new pair or null after recording the failure. */
    async function exchange(current: Stored): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
        let response: Response;
        try {
            response = await fetcher(PATREON_TOKEN_URL, {
                method: "POST", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "BannerlordCoop - website membership sync" },
                body: new URLSearchParams({
                    grant_type: "refresh_token", refresh_token: current.refreshToken,
                    client_id: options.clientId, client_secret: options.clientSecret,
                }),
            });
        } catch {
            await recordFailure(current.generation, "unavailable");
            return null;
        }
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            await recordFailure(current.generation, response.status === 400 || response.status === 401 ? "rejected" : "unavailable");
            return null;
        }
        let tokens: unknown;
        try { tokens = await boundedJson(response, 16_384); }
        catch { await recordFailure(current.generation, "unavailable"); return null; }
        if (!record(tokens) || !isCreatorToken(tokens.access_token) || !isCreatorToken(tokens.refresh_token)
            || tokens.access_token === tokens.refresh_token || !Number.isSafeInteger(tokens.expires_in)
            || Number(tokens.expires_in) < 60 || Number(tokens.expires_in) > MAX_EXPIRES_IN) {
            await recordFailure(current.generation, "unavailable");
            return null;
        }
        return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: Number(tokens.expires_in) };
    }

    /**
     * Rotates the stored pair. Patreon consumes the refresh token during the exchange, so the new
     * pair is the only valid one from then on: a store write that throws is sent once more, and a
     * reply that is not `rotated` is checked against the store before giving up.
     */
    async function refresh(current: Stored): Promise<string | null> {
        const issued = await exchange(current);
        if (issued === null) return null;
        const input = { generation: current.generation, ...issued };
        // Resolves to the reply, or undefined when the request itself failed (timeout, pool, lock budget).
        const write = () => options.rpc("rotate", input).catch(() => undefined);
        let reply = await write();
        if (reply === undefined) reply = await write();
        if (record(reply) && reply.rotated === true) return remember(issued.accessToken);
        // Either the write landed but its reply was lost, or another rotation won; the store decides.
        try {
            const state = await read();
            if (state.configured && state.accessToken === issued.accessToken) return remember(issued.accessToken);
        } catch { /* reported below */ }
        log("Patreon creator token rotation not stored");
        return null;
    }

    return {
        async current() {
            if (cached && cached.until > now()) return cached.accessToken;
            const state = await stored();
            if (state.refreshDue) {
                const rotated = await refresh(state);
                if (rotated !== null) return rotated;
            }
            return remember(state.accessToken);
        },
        async replace(rejected) {
            cached = null;
            const state = await stored();
            // A rotation that already landed supersedes the rejected token without another exchange.
            if (state.accessToken !== rejected) return remember(state.accessToken);
            return refresh(state);
        },
    };
}

/** Sends a creator-authenticated request and retries exactly once with a replacement token after a 401. */
export async function fetchWithCreatorToken(
    provider: CreatorTokenProvider, fetcher: typeof fetch, url: URL,
    init: { headers: Record<string, string>; redirect?: RequestRedirect },
): Promise<Response> {
    // Each attempt gets its own deadline; the retry must not inherit time spent on the refresh.
    const send = (token: string) => fetcher(url, {
        headers: { ...init.headers, authorization: `Bearer ${token}` },
        redirect: init.redirect ?? "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const token = await provider.current();
    const response = await send(token);
    if (response.status !== 401) return response;
    // Nobody reads a 401 body; release it before the replacement may throw.
    await response.body?.cancel().catch(() => undefined);
    const replacement = await provider.replace(token);
    return replacement === null ? response : send(replacement);
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
            method: "POST", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json" },
            body: JSON.stringify({ p_operation: operation, p_input: input }),
        });
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            // Fixed message so a missing migration or grant is distinguishable from a Patreon outage.
            console.warn("Patreon creator token store request failed");
            throw new Error("creator_token_rpc_failed");
        }
        return boundedJson(response, 16_384);
    };
}
