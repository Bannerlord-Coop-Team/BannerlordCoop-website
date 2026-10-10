import { hostingRegionLabel } from "./hosting-regions.ts";
import { resolveMailConfig, type MailConfig, type MailSettings } from "./mail.ts";
import { isEmailAddress, type SmtpMessage } from "./smtp.ts";

export type RegionRequester = { accountId: string | null; email: string | null };
export type RegionRequestedEvent = {
    requestId: string;
    region: string;
    createdAt: string;
    requester: RegionRequester;
};
export type RegionFullEvent = {
    region: string;
    serverId: string;
    createdAt: string;
    requester: RegionRequester;
};
type AlertEnvelope = { recipients: readonly string[]; from: string; fromName?: string };
// Administrator recipients for region alerts plus the shared sender and SMTP account.
export type RegionAlertSettings = MailSettings & { recipients: readonly string[] };
export type RegionAlertConfig = MailConfig & { recipients: readonly string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAXIMUM_RECIPIENTS = 20;
const MAXIMUM_TOKEN_SEGMENT_LENGTH = 16 * 1_024;

// Normalizes and validates the committed administrator recipient list.
export function parseRecipients(values: readonly string[]): string[] {
    const recipients = [...new Set(values.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
    if (recipients.length === 0 || recipients.length > MAXIMUM_RECIPIENTS) {
        throw new Error(`Alert recipients must list 1-${MAXIMUM_RECIPIENTS} email addresses`);
    }
    for (const recipient of recipients) {
        if (!isEmailAddress(recipient)) throw new Error(`Alert recipient is not an email address: ${recipient}`);
    }
    return recipients;
}

// Validates the committed recipients and mail settings, then returns null (alerting disabled)
// when the SMTP_PASS secret is unset.
export function resolveRegionAlertConfig(
    settings: RegionAlertSettings,
    env: (name: string) => string | undefined,
): RegionAlertConfig | null {
    const recipients = parseRecipients(settings.recipients);
    const mail = resolveMailConfig(settings, env);
    return mail === null ? null : { recipients, ...mail };
}

// The Supabase gateway has already verified the JWT signature (verify_jwt = true); this only
// reads informational claims for the alert and never grants anything.
export function requesterFromToken(token: string): RegionRequester {
    const none: RegionRequester = { accountId: null, email: null };
    const segments = token.split(".");
    const payload = segments[1] ?? "";
    if (segments.length !== 3 || payload.length === 0 || payload.length > MAXIMUM_TOKEN_SEGMENT_LENGTH) return none;
    try {
        const padded = payload.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - (payload.length % 4)) % 4);
        const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
        const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return none;
        const { sub, email } = claims as Record<string, unknown>;
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : null;
        return {
            accountId: typeof sub === "string" && UUID.test(sub) ? sub : null,
            email: normalizedEmail !== null && isEmailAddress(normalizedEmail) ? normalizedEmail : null,
        };
    } catch {
        return none;
    }
}

// Builds the administrator email for a newly accepted region request.
export function regionRequestAlertMessage(event: RegionRequestedEvent, envelope: AlertEnvelope): SmtpMessage {
    const label = hostingRegionLabel(event.region);
    return alertMessage(envelope, `Server region request: ${label}`, [
        `A server owner requested capacity in ${label}, which is currently full.`,
        "",
        `Region: ${label} (${event.region})`,
        `Requested by: ${requesterLabel(event.requester)}`,
        `Request ID: ${event.requestId}`,
        `Created: ${event.createdAt}`,
        "",
        "The request is outstanding. It consumed no quota and created no server, reservation or job.",
        "Capacity for this region still has to be added and assigned through the usual control-plane procedures.",
    ]);
}

// Builds the administrator email for a website-created server that used a region's last free slot.
export function regionFullAlertMessage(event: RegionFullEvent, envelope: AlertEnvelope): SmtpMessage {
    const label = hostingRegionLabel(event.region);
    return alertMessage(envelope, `Server region full: ${label}`, [
        `${label} has no free server slots after a website owner created a server there.`,
        "",
        `Region: ${label} (${event.region})`,
        `Server ID: ${event.serverId}`,
        `Created by: ${requesterLabel(event.requester)}`,
        `Created: ${event.createdAt}`,
        "",
        "New owners can only request this region until capacity is added through the usual control-plane procedures.",
    ]);
}

// Sends each region alert best-effort: the owner's durable result never depends on email delivery.
export function createRegionAlerts(options: AlertEnvelope & {
    send: (message: SmtpMessage) => Promise<void>;
    log?: (message: string) => void;
}): { regionRequested: (event: RegionRequestedEvent) => Promise<void>; regionFull: (event: RegionFullEvent) => Promise<void> } {
    const log = options.log ?? ((message: string) => console.error(message));
    const deliver = async (message: SmtpMessage, subject: string) => {
        try {
            await options.send(message);
        } catch (error) {
            log(`Region alert failed for ${subject}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
    };
    return {
        regionRequested: (event) => deliver(regionRequestAlertMessage(event, options), `request ${event.requestId}`),
        regionFull: (event) => deliver(regionFullAlertMessage(event, options), `full region ${event.region}`),
    };
}

// Formats the informational requester claims for an alert body.
function requesterLabel(requester: RegionRequester) {
    return `${requester.email ?? "unknown email"} (account ${requester.accountId ?? "unknown"})`;
}

// Wraps alert text in the committed sender and recipient envelope.
function alertMessage(envelope: AlertEnvelope, subject: string, lines: string[]): SmtpMessage {
    return {
        from: envelope.from,
        ...(envelope.fromName === undefined ? {} : { fromName: envelope.fromName }),
        to: envelope.recipients,
        subject: `[BannerlordCoop] ${subject}`,
        text: lines.join("\n"),
    };
}
