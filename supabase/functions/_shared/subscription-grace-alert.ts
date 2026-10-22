import { createHash, timingSafeEqual } from "node:crypto";
import { boundedJson } from "./membership.ts";
import { isEmailAddress, type SmtpMessage } from "./smtp.ts";

// One active removal grace the owner has not yet been emailed about.
export type SubscriptionGraceAlert = {
    serverId: string;
    serverName: string;
    graceId: string;
    dueAt: string;
    email: string | null;
};
// Service-role reads and the atomic per-grace claim; the claim returns its timestamp, or null when not claimed.
export type SubscriptionGraceStore = {
    pending(): Promise<SubscriptionGraceAlert[]>;
    claim(serverId: string, graceId: string): Promise<string | null>;
    release(serverId: string, graceId: string, claimedAt: string): Promise<boolean>;
};
type Sender = { from: string; fromName?: string };
type RunSummary = { pending: number; sent: number; skipped: number; failed: number };

const MAXIMUM_ALERTS = 100;
// Each send opens one SMTP session; the rest wait for the next hourly run.
const MAXIMUM_SENDS_PER_RUN = 20;
// 100 rows of at most ~700 bytes each (a 100-character name, 254-character email plus fixed fields) fit in 128 KiB.
const MAXIMUM_RESPONSE_BYTES = 131_072;
const MAXIMUM_NAME_LENGTH = 100;
const MINIMUM_SECRET_LENGTH = 16;
const MAXIMUM_SECRET_LENGTH = 4096;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_CHARACTERS = /\p{Cc}/u;

// Builds the owner email naming the server, the removal deadline and how to keep it.
export function subscriptionGraceMessage(alert: SubscriptionGraceAlert & { email: string }, siteUrl: string, sender: Sender): SmtpMessage {
    const deadline = `${alert.dueAt.slice(0, 10)} ${alert.dueAt.slice(11, 16)} UTC`;
    return {
        from: sender.from,
        ...(sender.fromName === undefined ? {} : { fromName: sender.fromName }),
        to: [alert.email],
        subject: `[BannerlordCoop] Your server "${alert.serverName}" has been stopped and will be removed after ${deadline}`,
        text: [
            `Your Bannerlord Co-op server "${alert.serverName}" has been stopped because the Patreon membership`
                + " funding it has ended or is no longer linked to your account. Players were warned and the campaign was saved.",
            "",
            `It is locked and scheduled for removal after ${deadline}.`,
            "",
            `To keep it, renew your membership or link a qualifying Patreon account at ${siteUrl}/account before then.`
                + " Once a qualifying membership is verified, removal is cancelled and the server is unlocked."
                + " It stays stopped; press Start to run it again.",
            "",
            "A final backup is taken before the server is removed. If you think this is a mistake, contact an administrator.",
        ].join("\n"),
    };
}

// Loads pending alerts and claims/releases graces through the service-role-only RPCs with bounded bodies.
export function createSubscriptionGraceStore(fetcher: typeof fetch, supabaseUrl: string, serviceKey: string): SubscriptionGraceStore {
    const rpc = async (name: string, body: Record<string, string>) => {
        const response = await fetcher(new URL(`/rest/v1/rpc/${name}`, supabaseUrl), {
            method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: "error",
            headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        });
        if (!response.ok) throw new Error(`${name} failed with ${response.status}`);
        return boundedJson(response, MAXIMUM_RESPONSE_BYTES);
    };
    return {
        pending: async () => parseSubscriptionGraceAlerts(await rpc("subscription_grace_alerts", {})),
        claim: async (serverId, graceId) => {
            const claimedAt = await rpc("claim_subscription_grace_alert", { p_server_id: serverId, p_grace_id: graceId });
            if (claimedAt === null) return null;
            if (!isTimestamp(claimedAt)) throw new Error("Subscription grace claim is invalid");
            return claimedAt;
        },
        release: async (serverId, graceId, claimedAt) => {
            const released = await rpc("release_subscription_grace_alert", { p_server_id: serverId, p_grace_id: graceId, p_notified_at: claimedAt });
            if (typeof released !== "boolean") throw new Error("Subscription grace release is invalid");
            return released;
        },
    };
}

// Validates the RPC rows; any malformed row fails the run instead of mailing partial data.
export function parseSubscriptionGraceAlerts(value: unknown): SubscriptionGraceAlert[] {
    if (!Array.isArray(value) || value.length > MAXIMUM_ALERTS) throw new Error("Subscription grace rows are invalid");
    return value.map((row) => {
        const { server_id, server_name, grace_id, due_at, email } = (row ?? {}) as Record<string, unknown>;
        if (typeof server_id !== "string" || !UUID.test(server_id) || typeof grace_id !== "string" || !UUID.test(grace_id)
            || typeof server_name !== "string" || server_name.trim().length === 0 || server_name.length > MAXIMUM_NAME_LENGTH
            || CONTROL_CHARACTERS.test(server_name) || !isTimestamp(due_at) || !(email === null || typeof email === "string")) {
            throw new Error("Subscription grace row is invalid");
        }
        return { serverId: server_id, serverName: server_name, graceId: grace_id, dueAt: due_at,
            email: isEmailAddress(email) ? email : null };
    });
}

// Handles the scheduled request: authenticates the scheduler, then claims, emails and releases on failure.
export function createSubscriptionGraceAlertHandler(options: Sender & {
    syncSecret: string;
    siteUrl: string;
    store: SubscriptionGraceStore;
    send: (message: SmtpMessage) => Promise<void>;
}): (request: Request) => Promise<Response> {
    const secretLength = options.syncSecret.length;
    if (secretLength < MINIMUM_SECRET_LENGTH || secretLength > MAXIMUM_SECRET_LENGTH) throw new Error("invalid_subscription_grace_sync_secret");
    return async (request) => {
        if (request.method !== "POST") return Response.json({ code: "method_not_allowed" }, { status: 405 });
        if (!secretEqual(request.headers.get("x-patreon-sync-key") ?? "", options.syncSecret)) {
            return Response.json({ code: "unauthorized" }, { status: 401 });
        }
        let pending: SubscriptionGraceAlert[];
        try {
            pending = await options.store.pending();
        } catch (error) {
            console.error(`Subscription grace alerts could not be read: ${describe(error)}`);
            return Response.json({ code: "unreadable" }, { status: 503 });
        }
        const summary = await notifyAll(pending, options);
        return Response.json({ code: "checked", ...summary }, { status: summary.failed > 0 ? 503 : 200 });
    };
}

// Notifies up to the per-run bound; accounts without an email are skipped and left pending.
async function notifyAll(pending: SubscriptionGraceAlert[], options: Sender & {
    siteUrl: string; store: SubscriptionGraceStore; send: (message: SmtpMessage) => Promise<void>;
}): Promise<RunSummary> {
    const summary: RunSummary = { pending: pending.length, sent: 0, skipped: 0, failed: 0 };
    for (const alert of pending) {
        if (summary.sent + summary.failed >= MAXIMUM_SENDS_PER_RUN) break;
        if (alert.email === null) { summary.skipped++; continue; }
        const outcome = await notifyOne({ ...alert, email: alert.email }, options);
        summary[outcome]++;
    }
    return summary;
}

// Claims one exact grace, sends its email, and releases the claim when delivery fails so the next run retries.
async function notifyOne(alert: SubscriptionGraceAlert & { email: string }, options: Sender & {
    siteUrl: string; store: SubscriptionGraceStore; send: (message: SmtpMessage) => Promise<void>;
}): Promise<"sent" | "skipped" | "failed"> {
    let claimedAt: string | null;
    try {
        claimedAt = await options.store.claim(alert.serverId, alert.graceId);
    } catch (error) {
        console.error(`Subscription grace claim failed for ${alert.serverId}: ${describe(error)}`);
        return "failed";
    }
    if (claimedAt === null) return "skipped";
    try {
        await options.send(subscriptionGraceMessage(alert, options.siteUrl, options));
        return "sent";
    } catch (error) {
        console.error(`Subscription grace email failed for ${alert.serverId}: ${describe(error)}`);
        await release(alert, claimedAt, options.store);
        return "failed";
    }
}

// Clears a failed claim; a failed release only leaves that grace marked notified.
async function release(alert: SubscriptionGraceAlert, claimedAt: string, store: SubscriptionGraceStore) {
    try {
        if (!await store.release(alert.serverId, alert.graceId, claimedAt)) {
            console.error(`Subscription grace claim was no longer held for ${alert.serverId}`);
        }
    } catch (error) {
        console.error(`Subscription grace release failed for ${alert.serverId}: ${describe(error)}`);
    }
}

// Names an error for logs without echoing recipient addresses or response bodies.
function describe(error: unknown): string {
    return error instanceof Error ? error.message : "unknown error";
}

// Accepts only exact millisecond UTC ISO timestamps that parse.
function isTimestamp(value: unknown): value is string {
    return typeof value === "string" && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

// Compares secrets in constant time regardless of their lengths.
function secretEqual(left: string, right: string): boolean {
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(left), digest(right));
}
