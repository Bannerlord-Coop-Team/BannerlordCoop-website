import { boundedJson, exact, HASH, UUID, parseSnapshot, randomToken, record, sha256, validUntil, type Policy } from "./membership.ts";
import { membershipStore, MembershipRateLimit, membershipRateLimitResponse, type StoreConfig } from "./membership-store.ts";
export function createWebsiteAccountHandler(config: StoreConfig & { policy: Policy | null }) {
    const store = membershipStore(config);
    const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    return async (request: Request) => {
        if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
        const authorization = request.headers.get("authorization"); if (!authorization?.startsWith("Bearer ")) return response({ error: "unauthorized" }, 401);
        try {
            const user = await store.user(authorization);
            const body = await boundedJson(new Response(request.body, { headers: request.headers }), 4096);
            if (!record(body)) return response({ error: "invalid_request" }, 400);
            if (body.operation === "status" && exact(body, ["operation"])) {
                const value = await store.rpc("membership_status", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId });
                if (!record(value) || typeof value.pending !== "boolean" || typeof value.verificationPending !== "boolean") throw new Error("Invalid status");
                const s = parseSnapshot(value.snapshot);
                return response({ version: 1, accountId: user.accountId, hasDiscord: user.discordUserId !== null, configured: config.policy !== null, verificationPending: value.verificationPending, membership: { linked: s.patreonUserId !== null, verification: s.verification, sync: value.pending ? "pending" : s.revision === "0" ? "not_needed" : "applied", verifiedAt: s.verifiedAt, validUntil: validUntil(s), retryAt: null, refreshMode: "oauth_reauthorization" } });
            }
            if ((body.operation === "recovery-status" && exact(body, ["operation", "provider", "token"]) && (body.token === null || typeof body.token === "string" && HASH.test(body.token)) || body.operation === "recovery-resolve" && exact(body, ["operation", "provider", "operationId"]) && typeof body.operationId === "string" && UUID.test(body.operationId)) && ["discord", "patreon"].includes(body.provider as string)) {
                return response(await store.rpc("membership_recovery", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId, p_provider: body.provider, p_operation_id: body.operationId ?? null, p_discard: body.operation === "recovery-resolve", p_token_hash: typeof body.token === "string" ? await sha256(body.token) : null }));
            }
            if (body.operation === "unlink" && exact(body, ["operation"])) {
                await store.rpc("membership_unlink", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId }); return response({ unlinked: true });
            }
            if (body.operation === "discord-start" && exact(body, ["operation", "returnPath"]) && ["/servers", "/account"].includes(body.returnPath as string)) {
                if (user.discordUserId !== null) return response({ error: "identity_repair" }, 409);
                const token = randomToken();
                await store.rpc("membership_discord_begin", { p_account_id: user.accountId, p_token_hash: await sha256(token), p_operation_id: crypto.randomUUID(), p_return_path: body.returnPath });
                return response({ token, accountId: user.accountId });
            }
            if (body.operation === "discord-check" && exact(body, ["operation", "token"]) && typeof body.token === "string" && HASH.test(body.token)) {
                return response(await store.rpc("membership_discord_check", { p_account_id: user.accountId, p_token_hash: await sha256(body.token) }));
            }
            if (body.operation === "discord-confirm" && exact(body, ["operation", "token"]) && typeof body.token === "string" && HASH.test(body.token)) {
                return response(await store.rpc("membership_discord_confirm", { p_account_id: user.accountId, p_token_hash: await sha256(body.token), p_discord_user_id: user.discordUserId }));
            }
            return response({ error: "invalid_request" }, 400);
        } catch (error) { return error instanceof MembershipRateLimit ? membershipRateLimitResponse() : response({ error: "account_unavailable" }, 503); }
    };
}
