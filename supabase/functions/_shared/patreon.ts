import { DatabaseContention, databaseContentionResponse, checkDatabaseContention } from "./database-contention.ts";
import { boundedJson, currentDiscord, exact, record, type Policy } from "./membership.ts";
import { membershipStore, MembershipRateLimit, membershipRateLimitResponse } from "./membership-store.ts";
import { PATREON_IDENTITY_URL, verifyPatreonMembership } from "./patreon-membership.ts";

export interface PatreonConfig {
    supabaseUrl: string;
    serviceRoleKey: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    siteUrl: string;
    fetch?: typeof fetch;
    policy?: Policy | null;
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
    const store = membershipStore(config);
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
            redirect: "error",
            signal: AbortSignal.timeout(4_000),
        });
        if (result.status === 429) throw new MembershipRateLimit();
        if (!result.ok) await checkDatabaseContention(result);
        if (!result.ok) throw new Error("Patreon storage operation failed");
        return await boundedJson(result) as Record<string, unknown>[];
    }

    async function issue(userId: string, kind: "state" | "complete", context: Record<string, unknown>, patreonUserId?: string, evidence?: unknown) {
        const value = token();
        await database("patreon_oauth_states", "POST", {
            token_hash: await hash(value), kind, user_id: userId,
            operation_id: context.operation_id, expected_generation: context.expected_generation, return_path: context.return_path,
            ...(evidence ? { evidence } : {}),
            ...(patreonUserId ? { patreon_user_id: patreonUserId } : {}),
            expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        return value;
    }

    async function consume(value: string, kind: "ticket" | "state"): Promise<Record<string, unknown> | null> {
        if (!tokenPattern.test(value)) return null;
        // DELETE ... RETURNING atomically consumes a token, including under concurrent callbacks.
        const query = new URLSearchParams({
            token_hash: `eq.${await hash(value)}`, kind: `eq.${kind}`,
            expires_at: `gt.${new Date().toISOString()}`,
        });
        const rows = await database(`patreon_oauth_states?${query}`, "DELETE");
        return rows[0] ?? null;
    }

    return async function handle(request: Request): Promise<Response> {
        if (request.method !== (mode === "callback" ? "GET" : "POST")) {
            return response("Method not allowed", 405, { Allow: mode === "callback" ? "GET" : "POST" });
        }
        let stage = "request";
        function callbackFailure(status?: number) {
            // Fixed stage/status only: never log URLs, codes, tokens, provider bodies, or accounts.
            console.warn("Patreon callback failed", { stage, ...(status === undefined ? {} : { status }) });
            return finish("error");
        }
        try {
            if (mode !== "callback") {
                const authorization = request.headers.get("Authorization");
                if (!authorization?.startsWith("Bearer ")) return response("Unauthorized", 401);
                const auth = await requestFetch(`${config.supabaseUrl}/auth/v1/user`, {
                    headers: { apikey: config.serviceRoleKey, Authorization: authorization },
                    redirect: "error",
            signal: AbortSignal.timeout(4_000),
                });
                if (!auth.ok) return response("Unauthorized", 401);
                const user = await boundedJson(auth);
                if (!record(user) || typeof user.id !== "string" || !user.id) return response("Unauthorized", 401);
                if (mode === "complete") {
                    const body = await boundedJson(new Response(request.body, { headers: request.headers }), 4096);
                    if (!record(body) || !exact(body, ["token"]) || typeof body.token !== "string" || !tokenPattern.test(body.token)) return response("Invalid completion token", 400);
                    const result = await store.rpc("membership_complete", { p_account_id: user.id, p_discord_user_id: currentDiscord(user), p_token_hash: await hash(body.token) });
                    return response(JSON.stringify(result), 200, { "Content-Type": "application/json" });
                }
                const body = await boundedJson(new Response(request.body, { headers: request.headers }), 4096);
                if (!record(body) || !exact(body, ["returnPath"]) || !["/account", "/servers"].includes(body.returnPath as string)) return response("Invalid return path", 400);
                const ticket = token();
                await store.rpc("membership_begin", { p_account_id: user.id, p_discord_user_id: currentDiscord(user), p_operation_id: crypto.randomUUID(), p_token_hash: await hash(ticket), p_return_path: body.returnPath });
                const url = new URL(callback);
                url.searchParams.set("ticket", ticket);
                return response(JSON.stringify({ url: url.href }), 200, { "Content-Type": "application/json" });
            }

            const url = new URL(request.url);
            const ticket = url.searchParams.get("ticket");
            if (ticket) {
                stage = "consume_ticket";
                const context = await consume(ticket, "ticket");
                if (!context || typeof context.user_id !== "string") return callbackFailure();
                stage = "issue_state";
                const state = await issue(context.user_id, "state", context);
                const authorize = new URL("https://www.patreon.com/oauth2/authorize");
                authorize.search = new URLSearchParams({
                    response_type: "code", client_id: config.clientId,
                    redirect_uri: callback.href, scope: "identity identity.memberships", state,
                }).toString();
                // Set the cookie on a top-level navigation, not a cross-site fetch.
                return redirect(authorize.href, `${cookieName}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
            }

            stage = "validate_state";
            const state = url.searchParams.get("state") ?? "";
            const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim())
                .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
            if (!tokenPattern.test(state) || cookie !== state) return callbackFailure();
            stage = "consume_state";
            const context = await consume(state, "state");
            if (!context || typeof context.user_id !== "string") return callbackFailure();
            if (url.searchParams.has("error")) return finish("cancelled");
            const code = url.searchParams.get("code");
            stage = "validate_code";
            if (!code || code.length > 4096) return callbackFailure();

            stage = "token_exchange";
            const exchange = await requestFetch("https://www.patreon.com/api/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "authorization_code", code, client_id: config.clientId,
                    client_secret: config.clientSecret, redirect_uri: callback.href,
                }),
                redirect: "error",
            signal: AbortSignal.timeout(4_000),
            });
            if (!exchange.ok) return callbackFailure(exchange.status);
            stage = "token_response";
            const tokens = await boundedJson(exchange, 16_384);
            if (!record(tokens) || typeof tokens.access_token !== "string" || !tokens.access_token || tokens.access_token.length > 4096) return callbackFailure();
            stage = "identity_request";
            const identityResponse = await requestFetch(PATREON_IDENTITY_URL, {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
                redirect: "error",
            signal: AbortSignal.timeout(4_000),
            });
            if (!identityResponse.ok) return callbackFailure(identityResponse.status);
            stage = "identity_response";
            const identity = await boundedJson(identityResponse, 262_144, details => {
                console.warn("Patreon identity response rejected", details);
            }, { allowJsonApi: true });
            stage = "verify_identity";
            const verified = await verifyPatreonMembership(identity, config.policy ?? null);
            // Tokens exist only in this callback; completion stores normalized evidence.
            stage = "issue_completion";
            const completionToken = await issue(context.user_id, "complete", context, verified.patreonUserId, verified.evidence);
            const completionUrl = new URL("/account/patreon/callback", config.siteUrl);
            completionUrl.searchParams.set("token", completionToken);
            return redirect(completionUrl.href, `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
        } catch (error) {
            if (error instanceof DatabaseContention) return mode === "callback" ? redirect(`${accountUrl}?patreon=retry`) : databaseContentionResponse();
            if (mode !== "callback" && error instanceof MembershipRateLimit) return membershipRateLimitResponse();
            // Never return provider bodies, tokens, codes, or database details to the browser.
            return mode === "callback" ? callbackFailure() : response("Unable to link Patreon account", 503);
        }
    };
}
