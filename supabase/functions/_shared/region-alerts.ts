import { ONBOARDING_REGION_LABELS, type OnboardingRegion } from "./server-onboarding-contract.ts";
import { isEmailAddress, type SmtpMessage, type SmtpOptions } from "./smtp.ts";

export type RegionRequester = { accountId: string | null; email: string | null };
export type RegionRequestedEvent = {
    requestId: string;
    region: OnboardingRegion;
    createdAt: string;
    requester: RegionRequester;
};
export type RegionFullEvent = {
    region: OnboardingRegion;
    serverId: string;
    createdAt: string;
    requester: RegionRequester;
};
type AlertEnvelope = { recipients: readonly string[]; from: string; fromName?: string };
// Delivery settings committed with the function; the SMTP password is the only runtime secret.
export type RegionAlertSettings = {
    recipients: readonly string[];
    from: string;
    fromName?: string;
    smtp: { hostname: string; port: number; username: string; tls?: "implicit" | "starttls" };
};
export type RegionAlertConfig = { recipients: readonly string[]; from: string; fromName?: string; smtp: SmtpOptions };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;
const MAXIMUM_RECIPIENTS = 20;
const MAXIMUM_NAME_LENGTH = 100;
const MAXIMUM_TOKEN_SEGMENT_LENGTH = 16 * 1_024;
// Supabase Edge Functions cannot open outbound connections to ports 25 and 587.
const BLOCKED_PORTS = new Set([25, 587]);

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

// Validates the committed settings first, so a bad commit fails tests and boot, then returns null
// (alerting disabled) when the SMTP_PASS secret is unset.
export function resolveRegionAlertConfig(
    settings: RegionAlertSettings,
    env: (name: string) => string | undefined,
): RegionAlertConfig | null {
    const recipients = parseRecipients(settings.recipients);
    const hostname = settings.smtp.hostname.trim();
    if (!HOSTNAME.test(hostname)) throw new Error("SMTP hostname is invalid");
    const port = settings.smtp.port;
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("SMTP port is invalid");
    if (BLOCKED_PORTS.has(port)) {
        throw new Error("SMTP ports 25 and 587 are blocked by Supabase Edge Functions; use 465 (implicit TLS) or another port the provider offers");
    }
    const username = settings.smtp.username.trim();
    if (!username) throw new Error("SMTP username is required");
    const tls = settings.smtp.tls ?? (port === 465 ? "implicit" : "starttls");
    if (tls !== "implicit" && tls !== "starttls") throw new Error("SMTP tls must be implicit or starttls");
    const from = settings.from.trim();
    if (!isEmailAddress(from)) throw new Error("Alert sender is not an email address");
    const fromName = settings.fromName?.trim();
    if (fromName !== undefined && (fromName.length === 0 || fromName.length > MAXIMUM_NAME_LENGTH || /[\x00-\x1f\x7f]/u.test(fromName))) {
        throw new Error("Alert sender name is invalid");
    }
    const password = env("SMTP_PASS")?.trim();
    if (!password) return null;
    return { recipients, from, ...(fromName === undefined ? {} : { fromName }), smtp: { hostname, port, tls, username, password } };
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
    const label = ONBOARDING_REGION_LABELS[event.region];
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
    const label = ONBOARDING_REGION_LABELS[event.region];
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
