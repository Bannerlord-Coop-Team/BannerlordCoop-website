import { checkDatabaseContention, DatabaseContention } from "./database-contention.ts";
import { boundedJson, currentDiscord, exact, record, UUID } from "./membership.ts";
// Closed retry contract: never expose PostgREST/provider errors to the browser.
export class MembershipRateLimit extends Error {}
export function membershipRateLimitResponse(): Response {
    // Queue delivery has no predictable deadline. Never prescribe a delay that
    // outlives authority or imply that waiting guarantees admission.
    return Response.json({ error: "membership_rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export type StoreConfig = {
    supabaseUrl: string;
    serviceRoleKey: string;
    fetch?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    random?: () => number;
};
export function membershipStore(config: StoreConfig) {
    const origin = new URL(config.supabaseUrl);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("Invalid Supabase origin");
    const requestFetch = config.fetch ?? fetch;
    const sleep = config.sleep ?? ((milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const random = config.random ?? Math.random;
    async function request(path: string, init: RequestInit, allowDeleted = false) {
        const deadline = Date.now() + 4_000;
        for (let attempt = 0; ; attempt++) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error("Membership service unavailable");
            const response = await requestFetch(new URL(path, origin), { ...init, redirect: "error", signal: AbortSignal.timeout(remaining), headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json", ...init.headers } });
            if (allowDeleted && response.status === 404) return null;
            if (response.status === 429) throw new MembershipRateLimit();
            let contention = false;
            if (!response.ok) {
                try { await checkDatabaseContention(response); }
                catch (error) { if (error instanceof DatabaseContention) contention = true; else throw error; }
                if (!contention) throw new Error("Membership service unavailable");
            }
            const value = contention ? null : await boundedJson(response);
            const typedRetry = record(value) && exact(value, ["version", "retry"])
                && [1, 2].includes(value.version as number) && value.retry === true;
            if (!contention && !typedRetry) return value;
            if (attempt >= 2) throw new DatabaseContention();
            const base = attempt === 0 ? 20 : 60;
            const jitter = attempt === 0 ? 20 : 40;
            await sleep(base + Math.floor(random() * jitter));
        }
    }
    return {
        async user(authorization: string) {
            const user = await request("/auth/v1/user", { headers: { Authorization: authorization } });
            if (!record(user) || typeof user.id !== "string" || !UUID.test(user.id)) throw new Error("Unauthorized");
            return { accountId: user.id, discordUserId: currentDiscord(user) };
        },
        async binding(accountId: string) {
            if (!UUID.test(accountId)) throw new Error("Invalid account");
            const response = await request(`/auth/v1/admin/users/${accountId}`, {}, true);
            if (response === null) return { discordUserId: null, deleted: true };
            // GoTrue admin getUserById returns a user, not browser metadata or identities from a JWT.
            if (!record(response) || response.id !== accountId) throw new Error("Auth account mismatch");
            return { discordUserId: currentDiscord(response), deleted: false };
        },
        rpc(name: "membership_fence" | "membership_begin" | "membership_complete" | "membership_unlink" | "membership_changes" | "membership_claim" | "membership_ack" | "membership_ack_claim" | "membership_status" | "membership_discord_begin" | "membership_discord_confirm" | "membership_discord_check" | "membership_recovery", body: Record<string, unknown>) { return request(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }); },
    };
}
