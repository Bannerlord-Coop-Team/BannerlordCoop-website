// Scheduled Boosty worker: when due, polls the complete subscriber list, links subscribers to
// website accounts by email and writes evidence. Any failed, partial or suspicious poll writes no
// link or loss: only evidence older than 24 hours becomes unknown, so an API break freezes evidence
// instead of removing servers.
import { createHash, timingSafeEqual } from "node:crypto";
import { boundedJson, record, timestamp, UUID } from "./membership.ts";
import { checkDatabaseContention, DatabaseContention } from "./database-contention.ts";
import { BoostyAuthError, MAX_SUBSCRIBER_PAGES, type BoostyApi, type BoostySubscriber } from "./boosty-api.ts";
import { BoostyCredentialUnavailable, serviceRpcEndpoint, type BoostyCredential } from "./boosty-credential.ts";
import { circuitBreakerTripped, decideBoostyEvidence, type LinkedBoostyHead } from "./boosty-evidence.ts";
import type { BoostyPolicy } from "./boosty-policy.ts";
import { BOOSTY_IDENTIFIER } from "./funding-provider.ts";

export type BoostySyncRpc = (operation: string, input: Record<string, unknown>) => Promise<unknown>;
export type BoostyAlert = "breaker_tripped";
/** A configured adapter: reviewed policy, creator credential and the bounded API client. */
export type BoostyAdapter = { policy: BoostyPolicy; credential: BoostyCredential; api: BoostyApi };
const MAX_LINKED_HEADS = 5000;
const EVIDENCE_BATCH = 200;
const MATCH_BATCH = 1000;
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
        /** Sends each subscriber whose email is unique in the complete list for matching; a shared email links no one. */
        async function matchEmails(token: string, subscribers: Map<string, BoostySubscriber>) {
            const counts = new Map<string, number>();
            for (const { emailSha256 } of subscribers.values()) if (emailSha256 !== null) counts.set(emailSha256, (counts.get(emailSha256) ?? 0) + 1);
            const unique = [...subscribers.values()].filter(({ emailSha256 }) => emailSha256 !== null && counts.get(emailSha256) === 1)
                .map(({ id, emailSha256 }) => ({ boostyUserId: id, emailSha256 }));
            for (let index = 0; index < unique.length; index += MATCH_BATCH) {
                await options.rpc("match", { token, subscribers: unique.slice(index, index + MATCH_BATCH) });
            }
        }

        /** Polls the complete subscriber list, matches emails and writes evidence, or freezes evidence when it cannot. */
        async function poll(token: string, lastCompleteCount: number | null, deadline: number): Promise<boolean> {
            let subscribers: Map<string, BoostySubscriber>;
            let heads: LinkedBoostyHead[];
            try {
                subscribers = await fetchCompleteSubscribers(adapter.api, deadline, now);
                if (circuitBreakerTripped(adapter.policy, lastCompleteCount, subscribers.size)) {
                    log("Boosty subscriber count dropped past the circuit breaker");
                    await freeze(token, true);
                    return false;
                }
                await matchEmails(token, subscribers);
                heads = parseLinked(await options.rpc("linked", { token }));
            } catch (error) {
                if (!(error instanceof IncompletePoll)) throw error;
                log("Boosty subscriber poll incomplete");
                await freeze(token, false);
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
        async function freeze(token: string, tripped: boolean) {
            await options.rpc("stale", { token });
            const recorded = await options.rpc("polled", { token, complete: false, tripped, total: null });
            if (tripped && record(recorded) && recorded.alert === true) await options.alert("breaker_tripped").catch(() => log("Boosty operator alert could not be sent"));
        }

        /** Stops the run after a credential failure: records a rejection (alerting) and freezes evidence. */
        async function credentialFailure(token: string, error: unknown) {
            if (error instanceof BoostyAuthError) await adapter.credential.reportFailure("rejected");
            await freeze(token, false);
            return reply(503, "credential_unavailable");
        }

        /** One leased run: the poll when due. A failed poll writes no link or loss. */
        async function run(token: string, lease: ReturnType<typeof parseLease>, deadline: number): Promise<Response> {
            if (!lease.pollDue) return reply(200, "synced");
            try { return await poll(token, lease.lastCompleteCount, deadline) ? reply(200, "synced") : reply(503, "sync_incomplete"); }
            catch (error) {
                if (error instanceof DatabaseContention) throw error;
                if (error instanceof BoostyAuthError || error instanceof BoostyCredentialUnavailable) return credentialFailure(token, error);
                log("Boosty subscriber poll failed");
                await freeze(token, false);
                return reply(503, "sync_incomplete");
            }
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
