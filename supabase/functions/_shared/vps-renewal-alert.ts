import { createHash, timingSafeEqual } from "node:crypto";
import { boundedJson } from "./membership.ts";
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
type IdleVpsRenewal = VpsRenewalHost & { expirationDate: string };
// Whether the renewal snapshot can be trusted: only "fresh" is verified data.
type SnapshotState = "fresh" | "empty" | "stale" | "unreadable";
export type VpsRenewalCheck = {
    idle: IdleVpsRenewal[];
    snapshot: SnapshotState;
    newestObservedAt: string | null;
};
type AlertEnvelope = { from: string; fromName?: string; recipients: readonly string[] };

const HOUR_MILLISECONDS = 60 * 60_000;
const DAY_MILLISECONDS = 24 * HOUR_MILLISECONDS;
const RENEWAL_WINDOW_MILLISECONDS = 5 * DAY_MILLISECONDS;
const MAXIMUM_SNAPSHOT_AGE_MILLISECONDS = 36 * HOUR_MILLISECONDS;
const RENEWAL_WINDOW_DAYS = RENEWAL_WINDOW_MILLISECONDS / DAY_MILLISECONDS;
const MAXIMUM_SNAPSHOT_AGE_HOURS = MAXIMUM_SNAPSHOT_AGE_MILLISECONDS / HOUR_MILLISECONDS;
const MAXIMUM_HOSTS = 256;
// 256 rows of at most ~450 bytes each (a 253-character service name plus fixed fields) fit in 128 KiB.
const MAXIMUM_RESPONSE_BYTES = 131_072;
const MINIMUM_SECRET_LENGTH = 16;
const MAXIMUM_SECRET_LENGTH = 4096;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/u;
// Fixed warning sentences for each unverified snapshot state; the stale one names the newest observation.
const SNAPSHOT_WARNINGS: Record<Exclude<SnapshotState, "fresh">, (newestObservedAt: string | null) => string> = {
    empty: () => "No VPS renewal data has been recorded by the control plane."
        + " The control plane may be unable to read the OVHcloud account.",
    stale: (newestObservedAt) => `The newest VPS renewal data was recorded at ${newestObservedAt},`
        + ` more than ${MAXIMUM_SNAPSHOT_AGE_HOURS} hours ago. The control plane may be unable to read the OVHcloud account.`,
    unreadable: () => "The VPS renewal data could not be read from the control plane."
        + " Check the vps-renewal-alert function logs.",
};
// Renewal-mode label for each OVHcloud auto-renew value; manual renewal tells the administrator to act.
const RENEWAL_MODES: Record<`${boolean | null}`, string> = {
    true: "auto-renews",
    false: "manual renewal: renew it in OVHcloud to keep it, otherwise it expires",
    null: "renewal mode unknown",
};
const FOOTER = "No action was taken automatically. Cancelling, renewing or resizing a VPS is a manual OVHcloud operation.";

// Finds idle VPSes renewing within the window and classifies the snapshot as fresh, empty or stale.
export function checkVpsRenewals(hosts: readonly VpsRenewalHost[], now: Date): VpsRenewalCheck {
    const deadline = now.valueOf() + RENEWAL_WINDOW_MILLISECONDS;
    const idle = hosts.filter((host): host is IdleVpsRenewal => host.usedSlots === 0
        && host.expirationDate !== null && Date.parse(host.expirationDate) <= deadline);
    if (hosts.length === 0) return { idle, snapshot: "empty", newestObservedAt: null };
    const newest = Math.max(...hosts.map((host) => Date.parse(host.observedAt)));
    const snapshot = now.valueOf() - newest <= MAXIMUM_SNAPSHOT_AGE_MILLISECONDS ? "fresh" : "stale";
    return { idle, snapshot, newestObservedAt: new Date(newest).toISOString() };
}

// Builds the administrator email: any snapshot warning, then the idle VPS list, then the footer.
export function vpsRenewalAlertMessage(check: VpsRenewalCheck, now: Date, envelope: AlertEnvelope): SmtpMessage {
    const subject = check.snapshot === "fresh"
        ? `${check.idle.length} unused VPS(es) renew within ${RENEWAL_WINDOW_DAYS} days`
        : "VPS renewals could not be verified";
    return {
        from: envelope.from,
        ...(envelope.fromName === undefined ? {} : { fromName: envelope.fromName }),
        to: envelope.recipients,
        subject: `[BannerlordCoop] ${subject}`,
        text: [...warningLines(check), ...listLines(check, now), FOOTER].join("\n"),
    };
}

// Leads an unverified email with why the data cannot be trusted; a fresh snapshot needs no warning.
function warningLines(check: VpsRenewalCheck): string[] {
    if (check.snapshot === "fresh") return [];
    const warning = `WARNING: ${SNAPSHOT_WARNINGS[check.snapshot](check.newestObservedAt)}`;
    if (check.idle.length === 0) return [warning, ""];
    return [warning, "The list below comes from that older data.", ""];
}

// Lists each idle VPS, or nothing when none are idle.
function listLines(check: VpsRenewalCheck, now: Date): string[] {
    if (check.idle.length === 0) return [];
    return [
        `These VPSes have no slots assigned to a server and renew within ${RENEWAL_WINDOW_DAYS} days:`, "",
        ...check.idle.map((host) => `- ${hostLine(host, now)}`), "",
    ];
}

// Describes one idle VPS: renewal date, time left, renewal mode and registration.
function hostLine(host: IdleVpsRenewal, now: Date): string {
    const when = timeLeft(Date.parse(host.expirationDate) - now.valueOf());
    return [host.serviceName, `renews ${host.expirationDate} (${when})`, RENEWAL_MODES[`${host.autoRenew}`],
        ...(host.registered ? [] : ["not registered as a control-plane host"])].join(" | ");
}

// Words the time until renewal: passed, within 24 hours, or whole days.
function timeLeft(remaining: number): string {
    if (remaining <= 0) return "date has passed";
    if (remaining < DAY_MILLISECONDS) return "within 24 hours";
    return `in ${Math.floor(remaining / DAY_MILLISECONDS)} day(s)`;
}

// Loads the renewal snapshot through the service-role-only RPC with a bounded body and rejects malformed rows.
export function createVpsRenewalHostLoader(fetcher: typeof fetch, supabaseUrl: string, serviceKey: string): () => Promise<VpsRenewalHost[]> {
    const endpoint = new URL("/rest/v1/rpc/vps_renewal_alert_hosts", supabaseUrl);
    return async () => {
        const response = await fetcher(endpoint, {
            method: "POST", body: "{}", signal: AbortSignal.timeout(10_000), redirect: "error",
            headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        });
        if (!response.ok) throw new Error(`VPS renewal query failed with ${response.status}`);
        return parseVpsRenewalHosts(await boundedJson(response, MAXIMUM_RESPONSE_BYTES));
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
    const secretLength = options.syncSecret.length;
    if (secretLength < MINIMUM_SECRET_LENGTH || secretLength > MAXIMUM_SECRET_LENGTH) throw new Error("invalid_vps_renewal_sync_secret");
    const clock = options.now ?? (() => new Date());
    return async (request) => {
        if (request.method !== "POST") return Response.json({ code: "method_not_allowed" }, { status: 405 });
        if (!secretEqual(request.headers.get("x-patreon-sync-key") ?? "", options.syncSecret)) {
            return Response.json({ code: "unauthorized" }, { status: 401 });
        }
        const now = clock();
        const check = await loadCheck(options.loadHosts, now);
        try {
            if (check.idle.length > 0 || check.snapshot !== "fresh") await options.alert(check, now);
        } catch (error) {
            console.error(`VPS renewal alert could not be delivered: ${error instanceof Error ? error.message : "unknown error"}`);
            return Response.json({ code: "alert_failed" }, { status: 503 });
        }
        return Response.json({ code: "checked", idle: check.idle.length, snapshot: check.snapshot });
    };
}

// Reads and checks the snapshot; a failed read becomes an "unreadable" check so the administrators are still warned.
async function loadCheck(loadHosts: () => Promise<VpsRenewalHost[]>, now: Date): Promise<VpsRenewalCheck> {
    try {
        return checkVpsRenewals(await loadHosts(), now);
    } catch (error) {
        console.error(`VPS renewal snapshot could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
        return { idle: [], snapshot: "unreadable", newestObservedAt: null };
    }
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
