import { DatabaseContention, databaseContentionResponse } from "./database-contention.ts";
import { boundedJson, DECIMAL, exact, HASH, parseSnapshot, record, sha256, UUID } from "./membership.ts";
import { membershipStore, type StoreConfig } from "./membership-store.ts";

export function createControlPlaneMembershipHandler(config: StoreConfig & { syncToken: string }) {
    if (!HASH.test(config.syncToken) || config.syncToken === config.serviceRoleKey) throw new Error("Dedicated membership credential required");
    if (config.supabaseUrl !== "https://wfvqnijwuyqjibhlcrhz.supabase.co") throw new Error("Membership project is pinned");
    const store = membershipStore(config);
    const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    return async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname !== "/functions/v1/control-plane-membership-v1" || url.search || request.method !== "POST" || request.headers.has("origin")) return respond({ error: "forbidden" }, 403);
        const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/u)?.[1];
        if (!token) return respond({ error: "unauthorized" }, 401);
        // Fixed-length digests and a full-length XOR comparison; no early differing-byte exit.
        const a = await sha256(token); const b = await sha256(config.syncToken); let difference = 0;
        for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
        if (difference !== 0) return respond({ error: "unauthorized" }, 401);
        let body: unknown;
        try { body = await boundedJson(new Response(request.body, { headers: request.headers }), 4096); }
        catch { return respond({ error: "invalid_request" }, 400); }
        if (!record(body) || ![1, 2].includes(body.version as number)) return respond({ error: "invalid_request" }, 400);
        try {
            if (body.operation === "snapshot" && body.version === 1 && exact(body, ["version", "operation", "accountId"]) && typeof body.accountId === "string" && UUID.test(body.accountId)) {
                const binding = await store.binding(body.accountId);
                return respond(parseSnapshot(await store.rpc("membership_fence", { p_account_id: body.accountId, p_discord_user_id: binding.discordUserId, p_deleted: binding.deleted })));
            }
            if (body.operation === "changes" && body.version === 1 && exact(body, ["version", "operation", "cursor", "limit"]) && (body.cursor === null || (typeof body.cursor === "string" && DECIMAL.test(body.cursor))) && Number.isInteger(body.limit) && (body.limit as number) >= 1 && (body.limit as number) <= 50) {
                const value = await store.rpc("membership_changes", { p_cursor: body.cursor, p_limit: body.limit });
                if (!record(value) || !exact(value, ["version", "cursor", "events"]) || value.version !== 1 || (value.cursor !== null && (typeof value.cursor !== "string" || !DECIMAL.test(value.cursor))) || !Array.isArray(value.events) || value.events.length > (body.limit as number) || !value.events.every(e => record(e) && exact(e, ["eventId", "accountId"]) && typeof e.eventId === "string" && UUID.test(e.eventId) && typeof e.accountId === "string" && UUID.test(e.accountId))) throw new Error("Invalid outbox");
                return respond(value);
            }
            if (body.operation === "claim" && body.version === 2 && exact(body, ["version", "operation", "claimId", "limit"]) && typeof body.claimId === "string" && UUID.test(body.claimId) && Number.isInteger(body.limit) && (body.limit as number) >= 1 && (body.limit as number) <= 50) {
                const value = await store.rpc("membership_claim", { p_claim_id: body.claimId, p_limit: body.limit });
                if (!record(value) || !exact(value, ["version", "claimId", "leaseExpiresAt", "events"]) || value.version !== 2 || value.claimId !== body.claimId || typeof value.leaseExpiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.leaseExpiresAt) || !Array.isArray(value.events) || value.events.length > (body.limit as number) || !value.events.every(e => record(e) && exact(e, ["eventId", "accountId"]) && typeof e.eventId === "string" && UUID.test(e.eventId) && typeof e.accountId === "string" && UUID.test(e.accountId))) throw new Error("Invalid outbox claim");
                return respond(value);
            }
            if (body.operation === "ack" && body.version === 1 && exact(body, ["version", "operation", "eventId", "receiptId"]) && typeof body.eventId === "string" && UUID.test(body.eventId) && typeof body.receiptId === "string" && UUID.test(body.receiptId)) {
                const value = await store.rpc("membership_ack", { p_event_id: body.eventId, p_receipt_id: body.receiptId });
                if (!record(value) || !exact(value, ["version", "acknowledged", "eventId", "receiptId"]) || value.version !== 1 || value.acknowledged !== true || value.eventId !== body.eventId || value.receiptId !== body.receiptId) throw new Error("Invalid acknowledgement");
                return respond(value);
            }
            if (body.operation === "ack" && body.version === 2 && exact(body, ["version", "operation", "eventId", "receiptId", "claimId"]) && typeof body.eventId === "string" && UUID.test(body.eventId) && typeof body.receiptId === "string" && UUID.test(body.receiptId) && typeof body.claimId === "string" && UUID.test(body.claimId)) {
                const value = await store.rpc("membership_ack_claim", { p_event_id: body.eventId, p_receipt_id: body.receiptId, p_claim_id: body.claimId });
                if (!record(value) || !exact(value, ["version", "acknowledged", "eventId", "receiptId", "claimId"]) || value.version !== 2 || value.acknowledged !== true || value.eventId !== body.eventId || value.receiptId !== body.receiptId || value.claimId !== body.claimId) throw new Error("Invalid claim acknowledgement");
                return respond(value);
            }
            return respond({ error: "invalid_request" }, 400);
        } catch (error) { return error instanceof DatabaseContention ? databaseContentionResponse() : respond({ error: "unavailable" }, 503); }
    };
}
