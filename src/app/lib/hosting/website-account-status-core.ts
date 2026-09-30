import { parseAccountStatus, type AccountStatus } from "./membership-onboarding";

interface WebsiteAccountClient {
    functions: {
        invoke(name: string, input: { headers: { Authorization: string }; body: { operation: "status" } }): Promise<{ data: unknown; error: unknown }>;
    };
}

// Dynamic account and server routes can render concurrently. Share only the
// in-flight request inside one server isolate; never cache a response or token.
export function createWebsiteAccountStatusReader(getClient: () => Promise<WebsiteAccountClient>) {
    const inFlight = new Map<string, Promise<AccountStatus>>();
    return async (accountId: string, accessToken: string, client?: WebsiteAccountClient): Promise<AccountStatus> => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken));
        const key = `${accountId}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
        const current = inFlight.get(key);
        if (current) return current;
        const request = (async () => {
            // A server render can reuse its already checked client. The Edge Function
            // still authenticates the explicit token and validates current session context.
            const requestClient = client ?? await getClient();
            const result = await requestClient.functions.invoke("website-account", {
                headers: { Authorization: `Bearer ${accessToken}` }, body: { operation: "status" },
            });
            if (result.error) throw new Error("Website account status is unavailable");
            return parseAccountStatus(result.data, accountId);
        })();
        inFlight.set(key, request);
        try { return await request; }
        finally { if (inFlight.get(key) === request) inFlight.delete(key); }
    };
}
