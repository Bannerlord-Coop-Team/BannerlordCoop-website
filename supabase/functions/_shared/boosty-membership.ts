// Scheduled Boosty worker: links DM'd codes, then (when due) polls the complete subscriber list
// and writes evidence. Any failed, partial or suspicious poll writes no loss: only evidence older
// than 24 hours becomes unknown, so an API break freezes evidence instead of removing servers.
import { createHash, timingSafeEqual } from "node:crypto";
import { boundedJson, record, timestamp, UUID } from "./membership.ts";
import { checkDatabaseContention, DatabaseContention } from "./database-contention.ts";
import { BoostyAuthError, MAX_SUBSCRIBER_PAGES, type BoostyApi, type BoostySubscriber } from "./boosty-api.ts";
import { BoostyCredentialUnavailable, serviceRpcEndpoint, type BoostyCredential } from "./boosty-credential.ts";
import { circuitBreakerTripped, decideBoostyEvidence, type LinkedBoostyHead } from "./boosty-evidence.ts";
import { linkCodeHash } from "./boosty-link-code.ts";
import type { BoostyPolicy } from "./boosty-policy.ts";
import { BOOSTY_IDENTIFIER } from "./funding-provider.ts";

export type BoostySyncRpc = (operation: string, input: Record<string, unknown>) => Promise<unknown>;
export type BoostyAlert = "breaker_tripped";
/** A configured adapter: reviewed policy, creator credential and the bounded API client. */
export type BoostyAdapter = { policy: BoostyPolicy; credential: BoostyCredential; api: BoostyApi };
const MAX_DIALOG_PAGES = 5;
const MAX_DUE_DIALOGS = 20;
const MAX_LINKED_HEADS = 5000;
const EVIDENCE_BATCH = 200;
const RUN_BUDGET_MS = 25_000;
const DECIMAL = /^(0|[1-9][0-9]{0,19})$/u;

/** A poll that cannot decide evidence; it is never treated as loss. */
class IncompletePoll extends Error {}

/** Compares secrets by fixed-length digests so neither length nor content leaks through timing. */
function secretEqual(left: string, right: string) {
    return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

/** Closed scheduler reply. */
function reply(status: number, code: string) {
    return Response.json({ code }, { status, headers: { "cache-control": "no-store" } });
}

/** Validates the lease reply of `acquire`. */
function parseLease(value: unknown) {
    if (!record(value) || typeof value.token !== "string" || !UUID.test(value.token) || typeof value.pollDue !== "boolean" || !timestamp(value.now)
        || !(value.lastCompleteCount === null || (Number.isSafeInteger(value.lastCompleteCount) && (value.lastCompleteCount as number) >= 0))) throw new Error("invalid_boosty_lease");
    return { token: value.token, pollDue: value.pollDue, now: value.now as string, lastCompleteCount: value.lastCompleteCount as number | null };
}

/** Validates the bounded linked-head list; more than the cap refuses the poll. */
function parseLinked(value: unknown): LinkedBoostyHead[] {
    if (!Array.isArray(value)) throw new Error("invalid_boosty_linked");
    if (value.length > MAX_LINKED_HEADS) throw new IncompletePoll("too_many_linked_heads");
    return value.map(row => {
        if (!record(row) || typeof row.accountId !== "string" || !UUID.test(row.accountId) || typeof row.providerUserId !== "string" || !BOOSTY_IDENTIFIER.test(row.providerUserId)
            || typeof row.linkGeneration !== "string" || !DECIMAL.test(row.linkGeneration) || !(row.absentSince === null || timestamp(row.absentSince))) throw new Error("invalid_boosty_linked");
        return { accountId: row.accountId, providerUserId: row.providerUserId, linkGeneration: row.linkGeneration, absentSince: row.absentSince as string | null };
    });
}

/** Reads every subscriber page; complete only when the list ends at its stated total without duplicates. */
export async function fetchCompleteSubscribers(api: BoostyApi, deadline: number, now: () => number): Promise<Map<string, BoostySubscriber>> {
    const seen = new Map<string, BoostySubscriber>();
    let total: number | null = null;
    for (let page = 0; page < MAX_SUBSCRIBER_PAGES; page++) {
        if (now() > deadline) throw new IncompletePoll("deadline");
        const result = await api.subscribers(seen.size);
        if (total !== null && result.total !== total) throw new IncompletePoll("total_changed");
        total = result.total;
        for (const subscriber of result.subscribers) {
            if (seen.has(subscriber.id)) throw new IncompletePoll("duplicate_subscriber");
            seen.set(subscriber.id, subscriber);
        }
        if (seen.size === total) return seen;
        if (result.subscribers.length === 0 || seen.size > total) throw new IncompletePoll("short_list");
    }
    throw new IncompletePoll("page_cap");
}

/** Builds the scheduled handler; dependencies are injected so tests assert every request. */
export function createBoostyMembershipHandler(options: {
    adapter: BoostyAdapter | null; syncSecret: string; rpc: BoostySyncRpc;
    alert: (kind: BoostyAlert) => Promise<void>; now?: () => number; log?: (message: string) => void;
}) {
    if (options.syncSecret.length < 16 || options.syncSecret.length > 4096) throw new Error("invalid_boosty_sync_secret");
    const now = options.now ?? Date.now;
    const log = options.log ?? ((message: string) => console.warn(message));

    /** Binds one configured adapter to the run phases below. */
    function runnerFor(adapter: BoostyAdapter) {
        /** Reads new dialog messages and applies exact code matches; returns after the bounded scan. */
        async function linkCodes(token: string, deadline: number) {
            const dialogs: { dialogId: string; chatmateId: string | null; lastMessageId: string; lastMessageAt: string | null }[] = [];
            let offset: string | null = null;
            for (let page = 0; page < MAX_DIALOG_PAGES && now() < deadline; page++) {
                const result = await adapter.api.dialogs(offset);
                for (const dialog of result.dialogs) if (dialog.lastMessageId !== null) dialogs.push({ ...dialog, lastMessageId: dialog.lastMessageId });
                if (result.nextOffset === null || result.nextOffset === offset) break;
                offset = result.nextOffset;
            }
            if (dialogs.length === 0) return;
            const due = await options.rpc("dialogs", { token, dialogs: dialogs.map(({ dialogId, lastMessageId, lastMessageAt }) => ({ dialogId: Number(dialogId), lastMessageId: Number(lastMessageId), lastMessageAt })) });
            if (!record(due) || !Array.isArray(due.due)) throw new Error("invalid_boosty_due");
            for (const entry of due.due.slice(0, MAX_DUE_DIALOGS)) {
                if (now() > deadline) return;
                if (!record(entry) || !Number.isSafeInteger(entry.dialogId) || !Number.isSafeInteger(entry.cursor)) throw new Error("invalid_boosty_due");
                const dialog = dialogs.find(value => value.dialogId === String(entry.dialogId));
                if (!dialog) continue;
                const messages = (await adapter.api.messages(dialog.dialogId)).filter(message => Number(message.messageId) > (entry.cursor as number));
                if (messages.length === 0) continue;
                // Only the counterparty's own messages can link; the creator's replies never do.
                const matches = await Promise.all(messages.filter(message => message.code !== null && dialog.chatmateId !== null && message.authorId === dialog.chatmateId)
                    .slice(0, 20).map(async message => ({ messageId: Number(message.messageId), boostyUserId: message.authorId, codeHash: await linkCodeHash(message.code!), messageAt: message.messageAt })));
                const cursor = Math.max(...messages.map(message => Number(message.messageId)));
                await options.rpc("link", { token, dialogId: entry.dialogId, cursor, matches });
            }
        }

        /** Polls the complete subscriber list and writes evidence, or freezes evidence when it cannot. */
        async function poll(token: string, lastCompleteCount: number | null, deadline: number): Promise<boolean> {
            let subscribers: Map<string, BoostySubscriber>;
            let heads: LinkedBoostyHead[];
            try {
                heads = parseLinked(await options.rpc("linked", { token }));
                subscribers = await fetchCompleteSubscribers(adapter.api, deadline, now);
            } catch (error) {
                if (!(error instanceof IncompletePoll)) throw error;
                log("Boosty subscriber poll incomplete");
                await freeze(token, false);
                return false;
            }
            if (circuitBreakerTripped(adapter.policy, lastCompleteCount, subscribers.size)) {
                log("Boosty subscriber count dropped past the circuit breaker");
                await freeze(token, true);
                return false;
            }
            const polledAt = new Date(now()).toISOString();
            const decisions = await Promise.all(heads.map(head => decideBoostyEvidence(adapter.policy, head, subscribers.get(head.providerUserId), polledAt)));
            for (let index = 0; index < decisions.length; index += EVIDENCE_BATCH) {
                await options.rpc("evidence", { token, results: decisions.slice(index, index + EVIDENCE_BATCH) });
            }
            await options.rpc("polled", { token, complete: true, tripped: false, total: subscribers.size });
            return true;
        }

        /** Marks only stale evidence unknown and records the failed poll; alerts on a breaker trip. */
        async function freeze(token: string, tripped: boolean, recordPoll = true) {
            await options.rpc("stale", { token });
            if (!recordPoll) return;
            const recorded = await options.rpc("polled", { token, complete: false, tripped, total: null });
            if (tripped && record(recorded) && recorded.alert === true) await options.alert("breaker_tripped").catch(() => log("Boosty operator alert could not be sent"));
        }

        /** Stops the run after a credential failure: records a rejection (alerting) and freezes evidence. */
        async function credentialFailure(token: string, error: unknown, pollDue: boolean) {
            if (error instanceof BoostyAuthError) await adapter.credential.reportFailure("rejected");
            await freeze(token, false, pollDue);
            return reply(503, "credential_unavailable");
        }

        /** One leased run: the link scan, then the poll when due. Neither phase's failure writes loss. */
        async function run(token: string, lease: ReturnType<typeof parseLease>, deadline: number): Promise<Response> {
            let code = "synced";
            try { await linkCodes(token, deadline); }
            catch (error) {
                if (error instanceof DatabaseContention) throw error;
                if (error instanceof BoostyAuthError || error instanceof BoostyCredentialUnavailable) return credentialFailure(token, error, lease.pollDue);
                log("Boosty link scan failed");
                code = "sync_incomplete";
            }
            if (!lease.pollDue) return reply(code === "synced" ? 200 : 503, code);
            try { if (!await poll(token, lease.lastCompleteCount, deadline)) code = "sync_incomplete"; }
            catch (error) {
                if (error instanceof DatabaseContention) throw error;
                if (error instanceof BoostyAuthError || error instanceof BoostyCredentialUnavailable) return credentialFailure(token, error, true);
                log("Boosty subscriber poll failed");
                await freeze(token, false);
                code = "sync_incomplete";
            }
            return reply(code === "synced" ? 200 : 503, code);
        }
        return run;
    }
    const adapter = options.adapter;
    const run = adapter === null ? null : runnerFor(adapter);

    return async (request: Request): Promise<Response> => {
        if (request.method !== "POST") return reply(405, "method_not_allowed");
        if (!secretEqual(request.headers.get("x-boosty-sync-key") ?? "", options.syncSecret)) return reply(401, "unauthorized");
        if (adapter === null || run === null) return reply(503, "not_configured");
        const deadline = now() + RUN_BUDGET_MS;
        let token: string | null = null;
        let outcome = reply(503, "sync_unavailable");
        try {
            const acquired = await options.rpc("acquire", { blog: adapter.policy.blog });
            if (acquired === null) return reply(200, "already_running");
            const lease = parseLease(acquired);
            token = lease.token;
            outcome = await run(token, lease, deadline);
        } catch (error) {
            outcome = error instanceof DatabaseContention ? reply(202, "sync_deferred") : reply(503, "sync_unavailable");
        } finally {
            if (token !== null) await options.rpc("release", { token }).catch(() => log("Boosty lease release failed"));
        }
        return outcome;
    };
}

/** Service-role adapter for the fixed `boosty_membership_sync` RPC; typed contention is retryable. */
export function createBoostySyncRpc(options: { supabaseUrl: string; serviceKey: string; fetchImplementation?: typeof fetch }): BoostySyncRpc {
    const endpoint = serviceRpcEndpoint(options.supabaseUrl, options.serviceKey, "boosty_membership_sync");
    return async (operation, input) => {
        const response = await (options.fetchImplementation ?? fetch)(endpoint, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
            headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json" },
            body: JSON.stringify({ p_operation: operation, p_input: input }),
        });
        if (!response.ok) { await checkDatabaseContention(response); throw new Error("boosty_sync_rpc_failed"); }
        return boundedJson(response, 1_048_576);
    };
}
