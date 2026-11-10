import { DatabaseContention, databaseContentionResponse } from "./database-contention.ts";
import { boundedJson, exact, HASH, parseSnapshot, randomToken, record, sha256, validUntil, type Policy } from "./membership.ts";
import { membershipStore, MembershipRateLimit, membershipRateLimitResponse, type StoreConfig } from "./membership-store.ts";
import { boostyAccountSurface } from "./boosty-account.ts";
import type { BoostyPolicy } from "./boosty-policy.ts";
import { fundingAccountOperation, type FundingAccountSurface } from "./funding-account.ts";
import type { FundingProvider } from "./funding-provider.ts";
/** The Edge Function and website server share the same bounded public status projection. */
export function websiteAccountStatus(value: unknown, user: { accountId: string; discordUserId: string | null }, configured: boolean) {
    if (!record(value) || typeof value.pending !== "boolean" || typeof value.verificationPending !== "boolean") throw new Error("Invalid status");
    const s = parseSnapshot(value.snapshot);
    if (s.accountId !== user.accountId || s.discordUserId !== user.discordUserId) throw new Error("Account status identity mismatch");
    return { version: 1, accountId: user.accountId, hasDiscord: user.discordUserId !== null, configured, verificationPending: value.verificationPending, membership: { linked: s.patreonUserId !== null, verification: s.verification, sync: value.pending ? "pending" : s.revision === "0" ? "not_needed" : "applied", verifiedAt: s.verifiedAt, validUntil: validUntil(s), retryAt: null, refreshMode: "oauth_reauthorization" } };
}
type AccountConfig = StoreConfig & { policy: Policy | null; boosty?: BoostyPolicy | null };
type Store = ReturnType<typeof membershipStore>;
type User = { accountId: string; discordUserId: string | null };

/** The account-surface registry: each funding provider's actions for one authenticated request.
 * Patreon keeps its unprefixed legacy names; its OAuth start is the separate patreon-start function. */
function fundingAccountSurfaces(config: AccountConfig, store: Store, user: User, respond: (body: unknown, status?: number) => Response): Record<FundingProvider, FundingAccountSurface> {
    return {
        patreon: { operations: {
            status: async body => {
                if (!exact(body, ["operation"])) return null;
                const value = await store.rpc("membership_status", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId });
                return respond(websiteAccountStatus(value, user, config.policy !== null));
            },
            unlink: async body => {
                if (!exact(body, ["operation"])) return null;
                await store.rpc("membership_unlink", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId }); return respond({ unlinked: true });
            },
        } },
        boosty: boostyAccountSurface(store, user, config.boosty ?? null, respond),
    };
}

/** Serves the authenticated website account: Discord identity linking plus every funding provider's account operations. */
export function createWebsiteAccountHandler(config: AccountConfig) {
    const store = membershipStore(config);
    const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    return async (request: Request) => {
        if (request.method === "GET") return response({ version: 1, configured: config.policy !== null });
        if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
        const authorization = request.headers.get("authorization"); if (!authorization?.startsWith("Bearer ")) return response({ error: "unauthorized" }, 401);
        try {
            const user = await store.user(authorization);
            const body = await boundedJson(new Response(request.body, { headers: request.headers }), 4096);
            if (!record(body)) return response({ error: "invalid_request" }, 400);
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
            // Funding operations keep each provider's wire names and replies; an unknown or malformed one is refused.
            const operation = fundingAccountOperation(fundingAccountSurfaces(config, store, user, response), body.operation);
            return (operation === null ? null : await operation(body)) ?? response({ error: "invalid_request" }, 400);
        } catch (error) { return error instanceof DatabaseContention ? databaseContentionResponse() : error instanceof MembershipRateLimit ? membershipRateLimitResponse() : response({ error: "account_unavailable" }, 503); }
    };
}
