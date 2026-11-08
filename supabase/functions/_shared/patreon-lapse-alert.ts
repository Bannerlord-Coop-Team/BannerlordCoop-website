import { createHash, timingSafeEqual } from "node:crypto";
import { boundedJson } from "./membership.ts";
import { isLapseTimestamp, reportGrantReason, type LapseInventory, type LapseServer } from "./patreon-lapse-inventory.ts";
import { isEmailAddress, type SmtpMessage } from "./smtp.ts";

export type LapseClassification = "grant-backed" | "in grace" | "review_required" | "untracked/grandfathered" | "deleted";
// No provider identity, owner email, server name or full account/server ID leaves the classifier.
export type LapseReportRow = Omit<LapseServer, "patreonUserId"> & {
    classification: LapseClassification;
    actionable: boolean;
};
export type LapseReport = { observedAt: string; rows: LapseReportRow[] };
type AlertEnvelope = { from: string; fromName?: string; recipients: readonly string[] };

// The deployed report has its own private operator list. Do not inherit a different shared alert list.
export function parseLapseReportRecipients(value: string | undefined): string[] {
    if (value === undefined || value.length > 5120) throw new Error("Invalid lapse report recipients");
    const recipients = [...new Set(value.split(",").map(item => item.trim().toLowerCase()))];
    if (recipients.length === 0 || recipients.length > 20 || !recipients.every(isEmailAddress)) {
        throw new Error("Invalid lapse report recipients");
    }
    return recipients;
}

const CLASS_ORDER: Record<LapseClassification, number> = {
    "untracked/grandfathered": 0, review_required: 1, "in grace": 2, "grant-backed": 3, deleted: 4,
};

// A missing Patreon subscription is a report candidate, not an instruction to suspend or delete it.
export function classifyLapseServers(inventory: LapseInventory, patrons: ReadonlySet<string>): LapseReport {
    if (!isLapseTimestamp(inventory.observedAt)) throw new Error("Invalid report clock");
    const rows: LapseReportRow[] = [];
    for (const server of inventory.servers) {
        if (server.patreonUserId !== null && patrons.has(server.patreonUserId)) continue;
        const classification: LapseClassification = server.deletedAt !== null ? "deleted"
            : server.independentQuota > 0 && server.ownerUsage <= server.independentQuota ? "grant-backed"
            : server.graceDueAt !== null ? "in grace"
            : !server.fundingRecorded ? "untracked/grandfathered" : "review_required";
        rows.push({
            serverPrefix: server.serverPrefix, accountPrefix: server.accountPrefix, deletedAt: server.deletedAt,
            independentQuota: server.independentQuota, ownerUsage: server.ownerUsage, fundingRecorded: server.fundingRecorded,
            graceDueAt: server.graceDueAt, verification: server.verification,
            grantReason: server.grantReason, grantRecordedAt: server.grantRecordedAt,
            classification, actionable: classification === "untracked/grandfathered"
            || classification === "review_required"
            || classification === "in grace" && server.graceDueAt !== null && server.graceDueAt <= inventory.observedAt });
    }
    rows.sort((left, right) => Number(right.actionable) - Number(left.actionable)
        || CLASS_ORDER[left.classification] - CLASS_ORDER[right.classification]
        || left.serverPrefix.localeCompare(right.serverPrefix));
    return { observedAt: inventory.observedAt, rows };
}

function rowLine(row: LapseReportRow): string {
    const identity = `server ${row.serverPrefix} / account ${row.accountPrefix ?? "none"}`;
    switch (row.classification) {
        case "grant-backed":
            return `${identity} | grant-backed | quota ${row.independentQuota}, usage ${row.ownerUsage}`
                + ` | grant reason: ${row.grantReason ? reportGrantReason(row.grantReason) : "historical grant; reason not retained"}`
                + ` | grant/quota recorded ${row.grantRecordedAt ?? "date not retained"}`;
        case "in grace":
            return `${identity} | in grace | deletion due ${row.graceDueAt}`
                + (row.actionable ? " | deadline reached; review worker evidence" : "");
        case "review_required":
            return `${identity} | review_required | membership ${row.verification ?? "unavailable"}; no active grace`;
        case "untracked/grandfathered":
            return `${identity} | untracked/grandfathered | no current funding record; review exact funding identity`;
        case "deleted":
            return `${identity} | deleted | recorded ${row.deletedAt}`;
    }
}

export function lapseReportText(report: LapseReport): string {
    const actionable = report.rows.filter(row => row.actionable);
    const context = report.rows.filter(row => !row.actionable);
    return [
        `Subscription funding report as of ${report.observedAt}`,
        `${actionable.length} row(s) need review; ${context.length} context row(s).`, "",
        "Needs review:", ...(actionable.length ? actionable.map(row => `- ${rowLine(row)}`) : ["- none"]), "",
        "Context:", ...(context.length ? context.map(row => `- ${rowLine(row)}`) : ["- none"]), "",
        "Grant notes do not establish an expiry. Grace deadlines remain subject to ControlPlane verification.",
        "No action was taken automatically.",
    ].join("\n");
}

export function lapseAlertMessage(report: LapseReport, envelope: AlertEnvelope): SmtpMessage {
    return {
        from: envelope.from, ...(envelope.fromName === undefined ? {} : { fromName: envelope.fromName }),
        to: envelope.recipients,
        subject: `[BannerlordCoop] Subscription funding: ${report.rows.filter(row => row.actionable).length} need review, ${report.rows.length} total`,
        text: lapseReportText(report),
    };
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

// Preserve the deployed report's $20 active-patron selection; all requests stay on this fixed Patreon route.
export async function fetchQualifyingPatrons(fetcher: typeof fetch, campaignId: string, creatorAccessToken: string): Promise<Set<string>> {
    if (!/^\d{1,32}$/u.test(campaignId)) throw new Error("Invalid Patreon campaign");
    const patrons = new Set<string>();
    const cursors = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 100; page++) {
        const url = new URL(`https://www.patreon.com/api/oauth2/v2/campaigns/${campaignId}/members`);
        url.searchParams.set("include", "user");
        url.searchParams.set("fields[member]", "patron_status,currently_entitled_amount_cents");
        url.searchParams.set("page[count]", "100");
        if (cursor) url.searchParams.set("page[cursor]", cursor);
        const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(10_000),
            headers: { authorization: `Bearer ${creatorAccessToken}`, "user-agent": "BannerlordCoop - patreon lapse alert" } });
        if (!response.ok) throw new Error("Patreon membership read failed");
        const body = await boundedJson(response, 512 * 1024, undefined, { allowJsonApi: true });
        if (!record(body) || !Array.isArray(body.data) || body.data.length > 100) throw new Error("Incomplete Patreon page");
        for (const member of body.data) {
            const user = record(member) && record(member.relationships) && record(member.relationships.user) ? member.relationships.user.data : null;
            const attributes = record(member) ? member.attributes : null;
            if (!record(user) || typeof user.id !== "string" || !/^\d{1,32}$/u.test(user.id)
                || !record(attributes) || !(attributes.patron_status === null
                    || typeof attributes.patron_status === "string" && attributes.patron_status.length <= 64)
                || !Number.isSafeInteger(attributes.currently_entitled_amount_cents) || (attributes.currently_entitled_amount_cents as number) < 0) {
                throw new Error("Incomplete Patreon member");
            }
            if (attributes.patron_status === "active_patron" && (attributes.currently_entitled_amount_cents as number) >= 2000) patrons.add(user.id);
        }
        const next = record(body.meta) && record(body.meta.pagination) && record(body.meta.pagination.cursors) ? body.meta.pagination.cursors.next : null;
        if (next === null || next === undefined || next === "") return patrons;
        if (typeof next !== "string" || next.length > 2048 || cursors.has(next)) throw new Error("Invalid Patreon pagination");
        cursors.add(next);
        cursor = next;
    }
    throw new Error("Patreon pagination exceeded its limit");
}

export function createPatreonLapseAlertHandler(options: {
    syncSecret: string;
    loadInventory: () => Promise<LapseInventory>;
    loadPatrons: () => Promise<ReadonlySet<string>>;
    alert: (report: LapseReport) => Promise<void>;
}): (request: Request) => Promise<Response> {
    if (options.syncSecret.length < 16 || options.syncSecret.length > 4096) throw new Error("Invalid lapse scheduler secret");
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return async request => {
        if (request.method !== "POST") return Response.json({ code: "method_not_allowed" }, { status: 405 });
        if (!timingSafeEqual(digest(request.headers.get("x-patreon-sync-key") ?? ""), digest(options.syncSecret))) {
            return Response.json({ code: "unauthorized" }, { status: 401 });
        }
        try {
            const [inventory, patrons] = await Promise.all([options.loadInventory(), options.loadPatrons()]);
            const report = classifyLapseServers(inventory, patrons);
            if (report.rows.length) await options.alert(report);
            return Response.json({ code: "checked", lapsed: report.rows.length, actionable: report.rows.filter(row => row.actionable).length });
        } catch {
            // Provider/DB errors can contain owner data or credentials. Keep scheduler failures bounded and private.
            console.error("Patreon lapse report could not be completed");
            return Response.json({ code: "check_failed" }, { status: 503 });
        }
    };
}
