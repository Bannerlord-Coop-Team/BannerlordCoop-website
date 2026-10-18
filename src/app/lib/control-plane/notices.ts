import { ControlPlaneAdminError } from "./client";
import type { HostingAdminNotice, HostingServerNoticeKind, HostingServerNoticeSeverity } from "./types";

/** The control plane's notice bounds; it validates every one again. */
export const NOTICE_LIMITS = { title: 120, body: 2_000, targets: 500, reason: 1_000 } as const;
const MAXIMUM_LIFETIME_MILLISECONDS = 366 * 86_400_000;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u;

export type NoticeForm = { title: string; body: string; severity: HostingServerNoticeSeverity; expiresAt: string; reason: string };
export type NoticeInput = {
    serverIds: string[];
    title: string;
    body: string;
    severity: HostingServerNoticeSeverity;
    expiresAt: string | null;
    reason?: string;
};

/** Converts a `datetime-local` value, read in the browser's time zone, to the control plane's UTC form with milliseconds. */
export function localDateTimeToUtc(value: string): string | null {
    if (!LOCAL_DATE_TIME.test(value)) return null;
    // A date-time string without an offset is local time.
    const date = new Date(value);
    return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

/** Builds the `create-notice` input from the form, or explains the first problem. */
export function noticeInput(form: NoticeForm, serverIds: readonly string[], now = Date.now()): { input: NoticeInput } | { error: string } {
    const unique = [...new Set(serverIds)];
    if (unique.length === 0) return { error: "Choose at least one server." };
    if (unique.length > NOTICE_LIMITS.targets) return { error: `A notice can target at most ${NOTICE_LIMITS.targets} servers.` };
    const title = form.title.trim();
    if (title.length === 0 || title.length > NOTICE_LIMITS.title || hasControlCharacter(title, false)) {
        return { error: `The title must be one line of 1 to ${NOTICE_LIMITS.title} characters.` };
    }
    const body = form.body.replace(/\r\n?/gu, "\n").trim();
    if (body.length === 0 || body.length > NOTICE_LIMITS.body || hasControlCharacter(body, true)) {
        return { error: `The message must be 1 to ${NOTICE_LIMITS.body} characters of plain text.` };
    }
    if (form.severity !== "info" && form.severity !== "warning") return { error: "Choose a severity." };
    let expiresAt: string | null = null;
    if (form.expiresAt.trim() !== "") {
        expiresAt = localDateTimeToUtc(form.expiresAt.trim());
        const remaining = expiresAt === null ? Number.NaN : Date.parse(expiresAt) - now;
        if (!(remaining > 0) || remaining > MAXIMUM_LIFETIME_MILLISECONDS) return { error: "The expiry must be in the future and within a year." };
    }
    const reason = form.reason.trim();
    if (reason.length > NOTICE_LIMITS.reason || hasControlCharacter(reason, false)) {
        return { error: `The reason must be one line of at most ${NOTICE_LIMITS.reason} characters.` };
    }
    return { input: { serverIds: unique, title, body, severity: form.severity, expiresAt, ...(reason === "" ? {} : { reason }) } };
}

/**
 * The request ID is the notice's idempotency key. Retrying the same notice after an uncertain
 * response reuses it, so the control plane returns the first notice instead of a duplicate;
 * changed content, or a submission after a confirmed one, gets a new ID.
 */
export function noticeRequestId(input: NoticeInput, previous: { fingerprint: string; requestId: string } | null, createId = () => crypto.randomUUID()) {
    const fingerprint = JSON.stringify({ ...input, serverIds: [...input.serverIds].sort() });
    return previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: createId() };
}

export function noticeErrorMessage(error: unknown, fallback: string) {
    if (error instanceof ControlPlaneAdminError && error.code === "notice_not_found") return "That notice no longer exists. Reload the list.";
    return error instanceof Error ? error.message : fallback;
}

const KIND_LABELS: Record<HostingServerNoticeKind, string> = {
    administrator: "Administrator",
    "placement-scheduled": "Move scheduled",
    "placement-completed": "Move completed",
};

export function noticeKindLabel(kind: HostingServerNoticeKind) {
    return KIND_LABELS[kind] ?? kind;
}

/** Names up to `limit` of the notice's servers, then how many more it targets. */
export function noticeTargetSummary(notice: Pick<HostingAdminNotice, "servers" | "targetCount">, limit = 5) {
    const names = notice.servers.slice(0, limit).map((server) => server.displayName);
    const more = notice.targetCount - names.length;
    return more > 0 ? `${names.join(", ")}${names.length > 0 ? ", " : ""}+${more} more` : names.join(", ");
}

/** Matches the control plane: no C0 control characters or DEL, except tab and newlines in the message. */
function hasControlCharacter(value: string, allowWhitespace: boolean) {
    for (const character of value) {
        const code = character.codePointAt(0)!;
        if (code === 127 || (code < 32 && !(allowWhitespace && (code === 9 || code === 10)))) return true;
    }
    return false;
}
