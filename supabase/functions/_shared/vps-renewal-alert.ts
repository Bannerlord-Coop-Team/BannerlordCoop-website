import { createHash, timingSafeEqual } from "node:crypto";
import type { SmtpMessage } from "./smtp.ts";

// One recorded OVHcloud account VPS with its renewal facts and the slots its non-deleted servers use.
export type VpsRenewalHost = {
    serviceName: string;
    expirationDate: string | null;
    autoRenew: boolean | null;
    observedAt: string;
    registered: boolean;
    usedSlots: number;
};
export type IdleVpsRenewal = VpsRenewalHost & { expirationDate: string };
export type VpsRenewalCheck = {
    idle: IdleVpsRenewal[];
    // Null when the snapshot is fresh; otherwise why the renewals could not be verified.
    snapshotProblem: string | null;
};
type AlertEnvelope = { from: string; fromName?: string; recipients: readonly string[] };

const DAY_MILLISECONDS = 24 * 60 * 60_000;
export const RENEWAL_WINDOW_MILLISECONDS = 5 * DAY_MILLISECONDS;
export const MAXIMUM_SNAPSHOT_AGE_MILLISECONDS = 36 * 60 * 60_000;
const MAXIMUM_HOSTS = 256;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/u;

// Finds idle VPSes renewing within five days and whether the snapshot is too old or empty to trust.
export function checkVpsRenewals(hosts: readonly VpsRenewalHost[], now: Date): VpsRenewalCheck {
    const deadline = now.valueOf() + RENEWAL_WINDOW_MILLISECONDS;
    const idle = hosts.filter((host): host is IdleVpsRenewal => host.usedSlots === 0
        && host.expirationDate !== null && Date.parse(host.expirationDate) <= deadline);
    return { idle, snapshotProblem: snapshotProblem(hosts, now) };
}

// Reports an empty or stale renewal snapshot so a stopped recorder never looks like "nothing renewing".
function snapshotProblem(hosts: readonly VpsRenewalHost[], now: Date): string | null {
    if (hosts.length === 0) return "No VPS renewal data has been recorded by the control plane.";
    const newest = Math.max(...hosts.map((host) => Date.parse(host.observedAt)));
    if (now.valueOf() - newest <= MAXIMUM_SNAPSHOT_AGE_MILLISECONDS) return null;
    return `The newest VPS renewal data was recorded at ${new Date(newest).toISOString()}, more than 36 hours ago.`;
}

// Builds the administrator email listing idle VPSes and any snapshot warning.
export function vpsRenewalAlertMessage(check: VpsRenewalCheck, now: Date, envelope: AlertEnvelope): SmtpMessage {
    const subject = check.snapshotProblem === null
        ? `${check.idle.length} unused VPS(es) renew within 5 days`
        : "VPS renewals could not be verified";
    const lines: string[] = [];
    if (check.snapshotProblem !== null) {
        lines.push(`WARNING: ${check.snapshotProblem} The control plane may be unable to read the OVHcloud account.`);
        if (check.idle.length > 0) lines.push("The list below comes from that older data.");
        lines.push("");
    }
    if (check.idle.length > 0) {
        lines.push("These VPSes have no slots assigned to a server and renew within 5 days:", "");
        lines.push(...check.idle.map((host) => `- ${hostLine(host, now)}`), "");
    }
    lines.push("No action was taken automatically. Cancelling, renewing or resizing a VPS is a manual OVHcloud operation.");
    return {
        from: envelope.from,
        ...(envelope.fromName === undefined ? {} : { fromName: envelope.fromName }),
        to: envelope.recipients,
        subject: `[BannerlordCoop] ${subject}`,
        text: lines.join("\n"),
    };
}

// Describes one idle VPS: renewal date, time left, renewal mode and registration.
function hostLine(host: IdleVpsRenewal, now: Date): string {
    const expiration = host.expirationDate;
    const remaining = Date.parse(expiration) - now.valueOf();
    const when = remaining <= 0 ? "date has passed" : `in ${Math.floor(remaining / DAY_MILLISECONDS)} day(s)`;
    const mode = host.autoRenew === true ? "auto-renews"
        : host.autoRenew === false ? "manual renewal: renew it in OVHcloud to keep it, otherwise it expires"
        : "renewal mode unknown";
    return [host.serviceName, `renews ${expiration} (${when})`, mode,
        ...(host.registered ? [] : ["not registered as a control-plane host"])].join(" | ");
}

// Loads the renewal snapshot through the service-role-only RPC and rejects malformed rows.
export function createVpsRenewalHostLoader(fetcher: typeof fetch, supabaseUrl: string, serviceKey: string): () => Promise<VpsRenewalHost[]> {
    const endpoint = new URL("/rest/v1/rpc/vps_renewal_alert_hosts", supabaseUrl);
    return async () => {
        const response = await fetcher(endpoint, {
            method: "POST", body: "{}", signal: AbortSignal.timeout(10_000), redirect: "error",
            headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        });
        if (!response.ok) throw new Error(`VPS renewal query failed with ${response.status}`);
        return parseVpsRenewalHosts(await response.json());
    };
}

// Validates the RPC rows; any malformed row fails the whole check instead of hiding a VPS.
export function parseVpsRenewalHosts(value: unknown): VpsRenewalHost[] {
    if (!Array.isArray(value) || value.length > MAXIMUM_HOSTS) throw new Error("VPS renewal rows are invalid");
    return value.map((row) => {
        const { service_name, expiration_date, auto_renew, observed_at, registered, used_slots } = (row ?? {}) as Record<string, unknown>;
        if (typeof service_name !== "string" || !SERVICE_NAME.test(service_name)
            || !(expiration_date === null || isTimestamp(expiration_date))
            || !(auto_renew === null || typeof auto_renew === "boolean")
            || !isTimestamp(observed_at) || typeof registered !== "boolean"
            || !Number.isSafeInteger(used_slots) || (used_slots as number) < 0) {
            throw new Error("VPS renewal row is invalid");
        }
        return {
            serviceName: service_name, expirationDate: expiration_date, autoRenew: auto_renew,
            observedAt: observed_at, registered, usedSlots: used_slots as number,
        };
    });
}

// Handles the scheduled request: authenticates the scheduler, runs the check and emails when needed.
export function createVpsRenewalAlertHandler(options: {
    syncSecret: string;
    loadHosts: () => Promise<VpsRenewalHost[]>;
    alert: (check: VpsRenewalCheck, now: Date) => Promise<void>;
    now?: () => Date;
}): (request: Request) => Promise<Response> {
    const clock = options.now ?? (() => new Date());
    return async (request) => {
        if (request.method !== "POST") return Response.json({ code: "method_not_allowed" }, { status: 405 });
        if (!secretEqual(request.headers.get("x-patreon-sync-key") ?? "", options.syncSecret)) {
            return Response.json({ code: "unauthorized" }, { status: 401 });
        }
        try {
            const now = clock();
            const check = checkVpsRenewals(await options.loadHosts(), now);
            if (check.idle.length > 0 || check.snapshotProblem !== null) await options.alert(check, now);
            return Response.json({ code: "checked", idle: check.idle.length, stale: check.snapshotProblem !== null });
        } catch (error) {
            console.error(`VPS renewal check failed: ${error instanceof Error ? error.message : "unknown error"}`);
            return Response.json({ code: "check_failed" }, { status: 503 });
        }
    };
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
