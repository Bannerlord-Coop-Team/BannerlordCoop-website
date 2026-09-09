import { checkDatabaseContention, DatabaseContention } from "./database-contention.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const ID = /^[1-9][0-9]{0,19}$/;
const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTS = new Set([
    "members:create", "members:update", "members:delete",
    "members:pledge:create", "members:pledge:update", "members:pledge:delete",
]);
const PATREON = "https://www.patreon.com/api/oauth2/v2/";
const MAX_BYTES = 1024 * 1024;

type ObjectValue = Record<string, unknown>;
type Rpc = (operation: string, input: ObjectValue) => Promise<unknown>;

export interface PatreonRoleOptions {
    campaignId: string;
    tierId: string;
    creatorAccessToken: string;
    webhookSecret: string;
    syncSecret: string;
    rpc: Rpc;
    fetchImplementation?: typeof fetch;
    now?: () => number;
}

function object(value: unknown): ObjectValue {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_response");
    return value as ObjectValue;
}

function resource(value: unknown, type: string, pattern: RegExp): ObjectValue {
    const result = object(value);
    if (result.type !== type || typeof result.id !== "string" || !pattern.test(result.id)) {
        throw new Error("invalid_resource");
    }
    return result;
}

function relationship(value: ObjectValue, name: string): unknown {
    return object(object(value.relationships)[name]).data;
}

function member(value: unknown, campaignId: string): ObjectValue {
    const result = resource(value, "member", MEMBER_ID);
    if (resource(relationship(result, "campaign"), "campaign", ID).id !== campaignId) {
        throw new Error("campaign_mismatch");
    }
    return result;
}

function discoveryCursor(page: ObjectValue, campaignId: string, previous: string): string {
    let cursor: unknown;
    // V2 documents the cursor in metadata. Some responses also include a next link.
    if (page.meta !== undefined) {
        cursor = object(object(object(page.meta).pagination).cursors).next;
    }
    if (page.links !== undefined) {
        const link = object(page.links).next;
        let linkedCursor: string | null = null;
        if (link !== undefined && link !== null) {
            if (typeof link !== "string" || link.length > 4096) throw new Error("invalid_cursor");
            const next = new URL(link);
            if (next.origin !== "https://www.patreon.com" || next.pathname !== `/api/oauth2/v2/campaigns/${campaignId}/members`
                || next.username || next.password || next.hash) throw new Error("invalid_cursor");
            linkedCursor = next.searchParams.get("page[cursor]");
            if (!linkedCursor || next.searchParams.getAll("page[cursor]").length !== 1) throw new Error("invalid_cursor");
        }
        if (cursor !== undefined && link !== undefined && (cursor ?? "") !== (linkedCursor ?? "")) throw new Error("invalid_cursor");
        cursor ??= linkedCursor;
    }
    if (page.meta === undefined && page.links === undefined) throw new Error("invalid_cursor");
    if (cursor === undefined || cursor === null || cursor === "") return "";
    if (typeof cursor !== "string" || cursor.length > 1024 || /\s/.test(cursor)
        || [...cursor].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || cursor === previous) {
        throw new Error("invalid_cursor");
    }
    return cursor;
}

export function parsePatreonMembership(value: unknown, campaignId: string, tierId: string, memberId: string) {
    const document = object(value);
    const data = member(document.data, campaignId);
    if (data.id !== memberId) throw new Error("member_mismatch");
    const userId = resource(relationship(data, "user"), "user", ID).id as string;
    const tiers = relationship(data, "currently_entitled_tiers");
    if (!Array.isArray(tiers) || tiers.length > 100) throw new Error("invalid_tiers");
    const entitled = tiers.map((tier) => resource(tier, "tier", ID).id).includes(tierId);
    const attributes = object(data.attributes);
    // Entitled tiers include an already-paid period after cancellation. A cancel
    // event itself never revokes access. Trials do not receive this paid benefit.
    let eligible = false;
    if (entitled) {
        if (![true, false, null].includes(attributes.is_free_trial as boolean | null) || typeof attributes.is_gifted !== "boolean") {
            throw new Error("billing_unavailable");
        }
        if (attributes.is_free_trial !== true) {
            if (attributes.is_gifted || attributes.last_charge_status === "Paid") eligible = true;
            else if (!["Declined", "Refunded", "Fraud", "Deleted"].includes(String(attributes.last_charge_status))) {
                throw new Error("billing_unavailable");
            }
        }
    }
    // The database resolves this stable identity through the existing OAuth link.
    // Email, display name and caller-controlled profile metadata are not authority.
    return { memberId, userId, eligible };
}

async function boundedBody(input: Request | Response): Promise<Uint8Array> {
    if (!input.body) throw new Error("missing_body");
    const reader = input.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let timedOut = false;
    const deadline = setTimeout(() => {
        timedOut = true;
        void reader.cancel().catch(() => undefined);
    }, 8_000);
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error("body_too_large");
            chunks.push(value);
        }
    } finally {
        clearTimeout(deadline);
        void reader.cancel().catch(() => undefined);
    }
    if (timedOut) throw new Error("body_timeout");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

async function json(response: Response): Promise<unknown> {
    if (!response.ok) throw new Error("upstream_unavailable");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBody(response))) as unknown;
}

function reply(status: number, code: string) {
    return Response.json({ code }, { status, headers: { "cache-control": "no-store" } });
}

function secretEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

export function createPatreonRoleHandler(options: PatreonRoleOptions) {
    if (!ID.test(options.campaignId) || !ID.test(options.tierId)) throw new Error("invalid_patreon_configuration");
    if (new Set([options.creatorAccessToken, options.webhookSecret, options.syncSecret]).size !== 3) {
        throw new Error("patreon_secrets_must_be_distinct");
    }
    for (const secret of [options.creatorAccessToken, options.webhookSecret, options.syncSecret]) {
        if (!secret || secret.length < 16 || secret.length > 4096) throw new Error("invalid_patreon_secret");
    }
    const fetcher = options.fetchImplementation ?? fetch;
    const now = options.now ?? Date.now;
    async function patreon(path: string, params: Record<string, string>) {
        const url = new URL(path, PATREON);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        return json(await fetcher(url, {
            headers: { authorization: `Bearer ${options.creatorAccessToken}`, "user-agent": "BannerlordCoop - website membership sync" },
            redirect: "error", signal: AbortSignal.timeout(8_000),
        }));
    }

    return async (request: Request): Promise<Response> => {
        if (request.method !== "POST") return reply(405, "method_not_allowed");
        // A dedicated scheduler secret is independent of Patreon and Supabase credentials.
        if (request.headers.has("x-patreon-sync-key")) {
            if (!secretEqual(request.headers.get("x-patreon-sync-key") ?? "", options.syncSecret)) return reply(401, "unauthorized");
            let token: string | undefined;
            let outcome: Response;
            try {
                const acquired = await options.rpc("acquire", {});
                if (acquired === null) return reply(200, "already_running");
                const lease = object(acquired);
                if (typeof lease.token !== "string" || !MEMBER_ID.test(lease.token) || !Array.isArray(lease.jobs) || lease.jobs.length > 20) {
                    throw new Error("invalid_lease");
                }
                token = lease.token;
                const started = now();
                // Drain existing work before discovery, so a failing scan cannot block revocations.
                let failed = false;
                for (const rawJob of lease.jobs) {
                    if (now() - started > 25_000) break;
                    const job = object(rawJob);
                    if (typeof job.memberId !== "string" || !MEMBER_ID.test(job.memberId)
                        || !Number.isSafeInteger(job.generation) || Number(job.generation) < 1) throw new Error("invalid_job");
                    try {
                        const result = await patreon(`members/${job.memberId}`, {
                            include: "campaign,currently_entitled_tiers,user",
                            "fields[member]": "is_free_trial,is_gifted,last_charge_status",
                        });
                        const snapshot = parsePatreonMembership(result, options.campaignId, options.tierId, job.memberId);
                        await options.rpc("complete", { token, generation: job.generation, ...snapshot });
                    } catch (error) {
                        if (error instanceof DatabaseContention) throw error;
                        failed = true;
                        // Retry the durable job. Never interpret HTTP errors as lost membership.
                        await options.rpc("failed", { token, memberId: job.memberId, generation: job.generation });
                        break; // Bound load after token expiry, throttling or network failure.
                    }
                }
                if (!failed && lease.scanDue === true && now() - started < 20_000) {
                    if (typeof lease.cursor !== "string" || lease.cursor.length > 1024
                        || !Number.isSafeInteger(lease.scanGeneration) || Number(lease.scanGeneration) < 1) throw new Error("invalid_cursor");
                    const params: Record<string, string> = { include: "campaign,user", "page[count]": "100" };
                    if (lease.cursor) params["page[cursor]"] = lease.cursor;
                    const page = object(await patreon(`campaigns/${options.campaignId}/members`, params));
                    if (!Array.isArray(page.data) || page.data.length > 1000) throw new Error("invalid_page");
                    const members = page.data.map((value) => {
                        const data = member(value, options.campaignId);
                        return { memberId: data.id, userId: resource(relationship(data, "user"), "user", ID).id };
                    });
                    const memberIds = members.map((value) => value.memberId);
                    if (new Set(memberIds).size !== memberIds.length) throw new Error("duplicate_member");
                    const cursor = discoveryCursor(page, options.campaignId, lease.cursor);
                    await options.rpc("discovered", { token, memberIds, members, cursor, scanGeneration: lease.scanGeneration });
                }
                outcome = reply(failed ? 503 : 200, failed ? "sync_incomplete" : "synced");
            } catch (error) {
                outcome = reply(503, error instanceof DatabaseContention ? "sync_retry" : "sync_unavailable");
            } finally {
                if (token) {
                    try { await options.rpc("release", { token }); }
                    catch (error) { outcome = reply(503, error instanceof DatabaseContention ? "sync_retry" : "sync_unavailable"); }
                }
            }
            return outcome;
        }
        if (!EVENTS.has(request.headers.get("x-patreon-event") ?? "")) return reply(400, "invalid_event");
        const signature = request.headers.get("x-patreon-signature") ?? "";
        if (!/^[0-9a-f]{32}$/i.test(signature)) return reply(401, "invalid_signature");
        let data: ObjectValue;
        try {
            const bytes = await boundedBody(request);
            const expected = createHmac("md5", options.webhookSecret).update(bytes).digest("hex");
            if (!secretEqual(signature.toLowerCase(), expected)) return reply(401, "invalid_signature");
            data = member(object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))).data, options.campaignId);
        } catch {
            return reply(400, "invalid_payload");
        }
        try {
            // Webhook content is a refresh signal, never role or deletion authority.
            await options.rpc("queue", { memberId: data.id });
            return reply(202, "queued");
        } catch (error) {
            return reply(503, error instanceof DatabaseContention ? "queue_retry" : "queue_unavailable");
        }
    };
}

export function createPatreonRoleRpc(options: {
    supabaseUrl: string; serviceKey: string; campaignId: string; tierId: string; fetchImplementation?: typeof fetch;
}): Rpc {
    const origin = new URL(options.supabaseUrl);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
        throw new Error("invalid_supabase_url");
    }
    if (!options.serviceKey || options.serviceKey.length < 20 || options.serviceKey.length > 4096) throw new Error("invalid_service_key");
    const endpoint = new URL("/rest/v1/rpc/patreon_role_sync", origin);
    return async (operation, input) => {
        const response = await (options.fetchImplementation ?? fetch)(endpoint, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
        headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json" },
        body: JSON.stringify({ p_campaign: options.campaignId, p_tier: options.tierId, p_operation: operation, p_input: input }),
        });
        if (!response.ok) await checkDatabaseContention(response);
        return json(response);
    };
}
