import { parseAccountStatus, type AccountStatus } from "./membership-onboarding";
import { boundedJson, exact, record, sha256 } from "../../../../supabase/functions/_shared/membership";
import { membershipStore, type StoreConfig } from "../../../../supabase/functions/_shared/membership-store";
import { websiteAccountStatus } from "../../../../supabase/functions/_shared/website-account";

/** Use the website's existing account credential after fresh identity and session checks. */
export async function readWebsiteAccountStatus(accessToken: string, config: StoreConfig & { publishableKey: string }) {
    if (accessToken.length < 20 || accessToken.length > 8192 || !config.serviceRoleKey || !config.publishableKey) throw new Error("Invalid account request");
    const store = membershipStore(config); // Also validates the fixed project origin before either request.
    const endpoint = new URL("/functions/v1/website-account", config.supabaseUrl);
    const requestFetch = config.fetch ?? fetch;
    const [user, configured] = await Promise.all([
        store.user(`Bearer ${accessToken}`),
        (async () => {
            const response = await requestFetch(endpoint, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4_000),
                headers: { apikey: config.publishableKey } });
            if (!response.ok) {
                await response.body?.cancel();
                if (response.status === 405) return null;
                throw new Error("Website account status is unavailable");
            }
            const flag = await boundedJson(response, 512);
            if (!record(flag) || !exact(flag, ["version", "configured"]) || flag.version !== 1 || typeof flag.configured !== "boolean") throw new Error("Invalid account configuration");
            return flag.configured;
        })(),
    ]);
    // An older function can remain active briefly while the automatic publishers roll out.
    if (configured === null) {
        const legacy = await requestFetch(endpoint, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4_000),
            headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ operation: "status" }) });
        if (!legacy.ok) { await legacy.body?.cancel(); throw new Error("Website account status is unavailable"); }
        return boundedJson(legacy, 4096);
    }
    const status = await store.rpc("membership_status", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId });
    return websiteAccountStatus(status, user, configured);
}

// Dynamic account and server routes can render concurrently. Share only the
// in-flight request inside one server isolate; never cache a response or token.
export function createWebsiteAccountStatusReader(readStatus: (accessToken: string) => Promise<unknown>) {
    const inFlight = new Map<string, Promise<AccountStatus>>();
    return async (accountId: string, accessToken: string): Promise<AccountStatus> => {
        const key = `${accountId}:${await sha256(accessToken)}`;
        const current = inFlight.get(key);
        if (current) return current;
        const request = readStatus(accessToken).then(value => parseAccountStatus(value, accountId));
        inFlight.set(key, request);
        try { return await request; }
        finally { if (inFlight.get(key) === request) inFlight.delete(key); }
    };
}
