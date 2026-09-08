import { boundedJson, currentDiscord, record, UUID } from "./membership.ts";
// Closed retry contract: never expose PostgREST/provider errors to the browser.
export class MembershipRateLimit extends Error {}
export function membershipRateLimitResponse(): Response {
    return Response.json({ error: "membership_rate_limited", retryAfterSeconds: 600 }, { status: 429, headers: { "Retry-After": "600", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export type StoreConfig = { supabaseUrl: string; serviceRoleKey: string; fetch?: typeof fetch };
export function membershipStore(config: StoreConfig) {
    const origin = new URL(config.supabaseUrl);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("Invalid Supabase origin");
    const requestFetch = config.fetch ?? fetch;
    async function request(path: string, init: RequestInit, allowDeleted = false) {
        const response = await requestFetch(new URL(path, origin), { ...init, redirect: "error", signal: AbortSignal.timeout(4_000), headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json", ...init.headers } });
        if (allowDeleted && response.status === 404) return null;
        if (response.status === 429) throw new MembershipRateLimit();
        if (!response.ok) throw new Error("Membership service unavailable");
        return boundedJson(response);
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
        rpc(name: "membership_fence" | "membership_begin" | "membership_complete" | "membership_unlink" | "membership_changes" | "membership_ack" | "membership_status" | "membership_discord_begin" | "membership_discord_confirm" | "membership_discord_check", body: Record<string, unknown>) { return request(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }); },
    };
}
