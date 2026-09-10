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
    return async (accountId: string, accessToken: string): Promise<AccountStatus> => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken));
        const key = `${accountId}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
        const current = inFlight.get(key);
        if (current) return current;
        const request = (async () => {
            const client = await getClient();
            const result = await client.functions.invoke("website-account", {
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
