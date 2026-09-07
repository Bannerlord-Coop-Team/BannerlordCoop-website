export interface PatreonConfig {
    supabaseUrl: string;
    serviceRoleKey: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    siteUrl: string;
    fetch?: typeof fetch;
}

const cookieName = "__Host-patreon-state";
const tokenPattern = /^[a-f0-9]{64}$/;

function token() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hash(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createPatreonHandler(config: PatreonConfig, mode: "start" | "callback" | "complete") {
    const requestFetch = config.fetch ?? fetch;
    const callback = new URL(config.redirectUri);
    const accountUrl = new URL("/account", config.siteUrl);
    if (callback.protocol !== "https:" || accountUrl.protocol !== "https:") {
        throw new Error("Patreon OAuth requires HTTPS callback and site URLs");
    }

    function response(body: string, status: number, headers: Record<string, string> = {}) {
        return new Response(body, {
            status,
            headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...headers },
        });
    }

    function redirect(url: string, cookie?: string) {
        return response("", 303, { Location: url, ...(cookie ? { "Set-Cookie": cookie } : {}) });
    }

    function finish(result: string) {
        const url = new URL(accountUrl);
        url.searchParams.set("patreon", result);
        return redirect(url.href, `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    }

    async function database(path: string, method: string, body?: unknown) {
        const result = await requestFetch(`${config.supabaseUrl}/rest/v1/${path}`, {
            method,
            headers: {
                apikey: config.serviceRoleKey,
                Authorization: `Bearer ${config.serviceRoleKey}`,
                "Content-Type": "application/json",
                Prefer: "return=representation,resolution=merge-duplicates",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(15_000),
        });
        if (!result.ok) throw new Error("Patreon storage operation failed");
        return result.json();
    }

    async function issue(userId: string, kind: "ticket" | "state" | "complete", patreonUserId?: string) {
        const value = token();
        await database("patreon_oauth_states", "POST", {
            token_hash: await hash(value), kind, user_id: userId,
            ...(patreonUserId ? { patreon_user_id: patreonUserId } : {}),
            expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        return value;
    }

    async function consume(value: string, kind: "ticket" | "state"): Promise<string | null> {
        if (!tokenPattern.test(value)) return null;
        // DELETE ... RETURNING atomically consumes a token, including under concurrent callbacks.
        const query = new URLSearchParams({
            token_hash: `eq.${await hash(value)}`, kind: `eq.${kind}`,
            expires_at: `gt.${new Date().toISOString()}`,
        });
        const rows = await database(`patreon_oauth_states?${query}`, "DELETE");
        return rows[0]?.user_id ?? null;
    }

    return async function handle(request: Request): Promise<Response> {
        if (request.method !== (mode === "callback" ? "GET" : "POST")) {
            return response("Method not allowed", 405, { Allow: mode === "callback" ? "GET" : "POST" });
        }
        try {
            if (mode !== "callback") {
                const authorization = request.headers.get("Authorization");
                if (!authorization?.startsWith("Bearer ")) return response("Unauthorized", 401);
                const auth = await requestFetch(`${config.supabaseUrl}/auth/v1/user`, {
                    headers: { apikey: config.serviceRoleKey, Authorization: authorization },
                    signal: AbortSignal.timeout(15_000),
                });
                if (!auth.ok) return response("Unauthorized", 401);
                const user = await auth.json();
                if (typeof user.id !== "string" || !user.id) return response("Unauthorized", 401);
                if (mode === "complete") {
                    const body = await request.json();
                    if (typeof body.token !== "string" || !tokenPattern.test(body.token)) {
                        return response("Invalid completion token", 400);
                    }
                    // Re-check the current site user before linking. Even a forwarded OAuth
                    // initiation URL cannot link a victim's Patreon to an attacker's account.
                    const query = new URLSearchParams({
                        token_hash: `eq.${await hash(body.token)}`, kind: "eq.complete",
                        user_id: `eq.${user.id}`, expires_at: `gt.${new Date().toISOString()}`,
                    });
                    const rows = await database(`patreon_oauth_states?${query}`, "DELETE");
                    if (!rows[0]?.patreon_user_id) return response("Invalid completion token", 400);
                    await database("patreon_accounts?on_conflict=user_id", "POST", {
                        user_id: user.id, patreon_user_id: rows[0].patreon_user_id,
                        linked_at: new Date().toISOString(),
                    });
                    return response(JSON.stringify({ linked: true }), 200, { "Content-Type": "application/json" });
                }
                // Opportunistic cleanup, never expose expired OAuth records to clients.
                await database(`patreon_oauth_states?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, "DELETE");
                const ticket = await issue(user.id, "ticket");
                const url = new URL(callback);
                url.searchParams.set("ticket", ticket);
                return response(JSON.stringify({ url: url.href }), 200, { "Content-Type": "application/json" });
            }

            const url = new URL(request.url);
            const ticket = url.searchParams.get("ticket");
            if (ticket) {
                const userId = await consume(ticket, "ticket");
                if (!userId) return finish("error");
                const state = await issue(userId, "state");
                const authorize = new URL("https://www.patreon.com/oauth2/authorize");
                authorize.search = new URLSearchParams({
                    response_type: "code", client_id: config.clientId,
                    redirect_uri: callback.href, scope: "identity", state,
                }).toString();
                // Set the cookie on a top-level navigation, not a cross-site fetch.
                return redirect(authorize.href, `${cookieName}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
            }

            const state = url.searchParams.get("state") ?? "";
            const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim())
                .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
            if (!tokenPattern.test(state) || cookie !== state) return finish("error");
            const userId = await consume(state, "state");
            if (!userId) return finish("error");
            if (url.searchParams.has("error")) return finish("cancelled");
            const code = url.searchParams.get("code");
            if (!code || code.length > 4096) return finish("error");

            const exchange = await requestFetch("https://www.patreon.com/api/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "authorization_code", code, client_id: config.clientId,
                    client_secret: config.clientSecret, redirect_uri: callback.href,
                }),
                signal: AbortSignal.timeout(15_000),
            });
            if (!exchange.ok) return finish("error");
            const tokens = await exchange.json();
            if (typeof tokens.access_token !== "string" || !tokens.access_token) return finish("error");
            const identityResponse = await requestFetch("https://www.patreon.com/api/oauth2/v2/identity", {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
                signal: AbortSignal.timeout(15_000),
            });
            if (!identityResponse.ok) return finish("error");
            const identity = await identityResponse.json();
            if (identity.data?.type !== "user" || typeof identity.data.id !== "string" || !identity.data.id) {
                return finish("error");
            }
            // Identity-only linking: discard OAuth tokens rather than retain unnecessary secrets.
            // Finish on the website so we can verify the browser's current Supabase user.
            const completionToken = await issue(userId, "complete", identity.data.id);
            const completionUrl = new URL("/account/patreon/callback", config.siteUrl);
            completionUrl.searchParams.set("token", completionToken);
            return redirect(completionUrl.href, `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
        } catch {
            // Never return provider bodies, tokens, codes, or database details to the browser.
            return mode === "callback" ? finish("error") : response("Unable to link Patreon account", 503);
        }
    };
}
