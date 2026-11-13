// Boosty creator credential: a device id plus a refresh token that Boosty rotates on every use
// (the previous one stops working). The current set lives in Supabase Vault behind the
// service-role-only `boosty_creator_credential` RPC; function secrets only seed it once.
//
// Invariant: refreshes happen only under the boosty-membership worker lease, so one worker
// refreshes at a time, and the rotated pair is stored before the new access token is used.
import { boundedJson, record } from "./membership.ts";
import { BOOSTY_API_ORIGIN } from "./boosty-api.ts";
import { isCreatorToken, type CreatorTokenProvider } from "./patreon-creator-token.ts";

export const BOOSTY_TOKEN_URL = new URL("/oauth/token/", BOOSTY_API_ORIGIN).href;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const MAX_EXPIRES_IN = 366 * 86_400;
const REQUEST_TIMEOUT_MS = 8_000;

export type BoostyCredentialOperation = "read" | "seed" | "rotate" | "failed";
export type BoostyCredentialRpc = (operation: BoostyCredentialOperation, input: Record<string, unknown>) => Promise<unknown>;
export type BoostyFailure = "rejected" | "unavailable";
/** Credential provider that can also record an API-side rejection (and alert on it). */
export interface BoostyCredential extends CreatorTokenProvider { reportFailure(reason: BoostyFailure): Promise<void> }
/** Raised when no usable access token exists; the run must stop without writing loss. */
export class BoostyCredentialUnavailable extends Error {}

type Stored = { deviceId: string; refreshToken: string; accessToken: string | null; generation: number; refreshDue: boolean };

/** Validates the store's read reply; anything unexpected is a store failure. */
function readState(value: unknown): Stored | null {
    if (!record(value) || typeof value.configured !== "boolean") throw new Error("invalid_boosty_credential_state");
    if (!value.configured) return null;
    if (typeof value.deviceId !== "string" || !DEVICE_ID.test(value.deviceId) || !isCreatorToken(value.refreshToken)
        || !(value.accessToken === null || isCreatorToken(value.accessToken)) || !Number.isSafeInteger(value.generation)
        || (value.generation as number) < 1 || typeof value.refreshDue !== "boolean") throw new Error("invalid_boosty_credential_state");
    return { deviceId: value.deviceId, refreshToken: value.refreshToken, accessToken: value.accessToken as string | null, generation: value.generation as number, refreshDue: value.refreshDue };
}

/** Builds the rotating Vault-backed credential; `alert` receives fixed failure kinds only. */
export function createBoostyCredential(options: {
    bootstrap: { deviceId: string; refreshToken: string }; rpc: BoostyCredentialRpc;
    alert: (reason: BoostyFailure) => Promise<void>; fetchImplementation?: typeof fetch; log?: (message: string) => void;
}): BoostyCredential {
    if (!DEVICE_ID.test(options.bootstrap.deviceId) || !isCreatorToken(options.bootstrap.refreshToken)) throw new Error("invalid_boosty_credential_bootstrap");
    const fetcher = options.fetchImplementation ?? fetch;
    // Fixed messages only: never tokens, response bodies or exception text.
    const log = options.log ?? ((message: string) => console.warn(message));

    /** Current stored set, seeding from the function secrets on first use. */
    async function stored(): Promise<Stored> {
        const state = readState(await options.rpc("read", {}));
        if (state) return state;
        await options.rpc("seed", { ...options.bootstrap });
        const seeded = readState(await options.rpc("read", {}));
        if (!seeded) throw new BoostyCredentialUnavailable("boosty_credential_unavailable");
        return seeded;
    }

    /** Records a failure for this generation and alerts when the store says one is due. */
    async function recordFailure(generation: number, reason: BoostyFailure) {
        log(reason === "rejected" ? "Boosty creator credential rejected" : "Boosty creator credential unavailable");
        let alert = false;
        try { const reply = await options.rpc("failed", { generation, reason }); alert = record(reply) && reply.alert === true; }
        catch { alert = true; /* An unrecordable failure still alerts. */ }
        if (alert) await options.alert(reason).catch(() => log("Boosty operator alert could not be sent"));
    }

    /** Exchanges the refresh token for a new set; returns null after recording any failure. */
    async function exchange(current: Stored): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
        let response: Response;
        try {
            response = await fetcher(BOOSTY_TOKEN_URL, {
                method: "POST", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "BannerlordCoop - website membership sync" },
                body: new URLSearchParams([["device_id", current.deviceId], ["device_os", "web"], ["grant_type", "refresh_token"], ["refresh_token", current.refreshToken]]),
            });
        } catch { await recordFailure(current.generation, "unavailable"); return null; }
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            await recordFailure(current.generation, [400, 401, 403].includes(response.status) ? "rejected" : "unavailable");
            return null;
        }
        let tokens: unknown;
        try { tokens = await boundedJson(response, 16_384); } catch { await recordFailure(current.generation, "unavailable"); return null; }
        if (!record(tokens) || !isCreatorToken(tokens.access_token) || !isCreatorToken(tokens.refresh_token) || tokens.access_token === tokens.refresh_token
            || !Number.isSafeInteger(tokens.expires_in) || (tokens.expires_in as number) < 60 || (tokens.expires_in as number) > MAX_EXPIRES_IN) {
            await recordFailure(current.generation, "unavailable");
            return null;
        }
        return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in as number };
    }

    /** Rotates and stores the set before returning the new access token; a lost reply is re-read. */
    async function refresh(current: Stored): Promise<string | null> {
        const issued = await exchange(current);
        if (issued === null) return null;
        const input = { generation: current.generation, ...issued };
        const write = () => options.rpc("rotate", input).catch(() => undefined);
        let reply = await write();
        if (reply === undefined) reply = await write();
        if (record(reply) && reply.rotated === true) return issued.accessToken;
        try {
            const state = readState(await options.rpc("read", {}));
            if (state?.accessToken === issued.accessToken) return issued.accessToken;
        } catch { /* reported below */ }
        // Boosty already consumed the old refresh token: an unstored rotation is a lost credential.
        await recordFailure(current.generation, "unavailable");
        return null;
    }

    return {
        async current() {
            const state = await stored();
            if (state.refreshDue || state.accessToken === null) {
                const rotated = await refresh(state);
                if (rotated !== null) return rotated;
            }
            if (state.accessToken === null) throw new BoostyCredentialUnavailable("boosty_credential_unavailable");
            return state.accessToken;
        },
        async replace(rejected) {
            const state = await stored();
            if (state.accessToken !== null && state.accessToken !== rejected) return state.accessToken;
            return refresh(state);
        },
        async reportFailure(reason) {
            const state = await stored();
            await recordFailure(state.generation, reason);
        },
    };
}

/** Service-role adapter for the fixed `boosty_creator_credential` RPC. */
export function createBoostyCredentialRpc(options: { supabaseUrl: string; serviceKey: string; fetchImplementation?: typeof fetch }): BoostyCredentialRpc {
    const endpoint = serviceRpcEndpoint(options.supabaseUrl, options.serviceKey, "boosty_creator_credential");
    return async (operation, input) => {
        const response = await (options.fetchImplementation ?? fetch)(endpoint, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json" },
            body: JSON.stringify({ p_operation: operation, p_input: input }),
        });
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error("boosty_credential_rpc_failed"); }
        return boundedJson(response, 16_384);
    };
}

/** Validates the fixed project origin and service key, then names one RPC endpoint. */
export function serviceRpcEndpoint(supabaseUrl: string, serviceKey: string, name: string): URL {
    const origin = new URL(supabaseUrl);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("invalid_supabase_url");
    if (!serviceKey || serviceKey.length < 20 || serviceKey.length > 4096) throw new Error("invalid_service_key");
    return new URL(`/rest/v1/rpc/${name}`, origin);
}
