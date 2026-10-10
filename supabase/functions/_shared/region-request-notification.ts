import { hostingRegionLabel } from "./hosting-regions.ts";
import type { SmtpMessage } from "./smtp.ts";

/** One parsed control-plane admin response envelope. */
export type ControlPlaneReply = { status: number; body: unknown };
/** Sends one internal operation to the control plane on the administrator's behalf. */
export type ControlPlaneCall = (operation: string, input: Record<string, unknown>) => Promise<ControlPlaneReply>;
export type RegionRequestNotificationOutcome =
    | { ok: true; result: { requestId: string; notifiedAt: string; sent: boolean } }
    | { ok: false; status: number; error: { code: string; message: string; retryable: boolean } };
/** Handles one raw `notify-region-request` input, reaching the control plane only through `call`. */
export type RegionRequestNotifier = (input: unknown, call: ControlPlaneCall) => Promise<RegionRequestNotificationOutcome>;
type Sender = { from: string; fromName?: string };
type Claim = { requestId: string; region: string; requesterEmail: string; notifiedAt: string; claimed: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Builds the requester email announcing that their requested region has capacity.
export function regionCapacityMessage(claim: Pick<Claim, "region" | "requesterEmail">, siteUrl: string, sender: Sender): SmtpMessage {
    const label = hostingRegionLabel(claim.region);
    return {
        from: sender.from,
        ...(sender.fromName === undefined ? {} : { fromName: sender.fromName }),
        to: [claim.requesterEmail],
        subject: `[BannerlordCoop] Server capacity available: ${label}`,
        text: [
            `Good news! Server capacity is now available in ${label}, the region you requested.`,
            "",
            `Head to ${siteUrl}/servers to set up your server.`,
            "",
            "You are receiving this because you requested a managed server region on Bannerlord Coop.",
        ].join("\n"),
    };
}

// Claims the request's single notification, emails the requester a link to the canonical site, and releases
// the claim if delivery fails.
export function createRegionRequestNotifier(options: Sender & {
    siteUrl: string;
    send: (message: SmtpMessage) => Promise<void>;
    log?: (message: string) => void;
}): RegionRequestNotifier {
    const log = options.log ?? ((message: string) => console.error(message));
    return async (input, call) => {
        const requestId = parseInput(input);
        if (requestId === null) {
            return { ok: false, status: 400, error: { code: "invalid_request", message: "The request is invalid.", retryable: false } };
        }
        const reply = await call("claim-region-request-notification", { requestId });
        const failure = envelopeError(reply);
        if (failure !== null) return failure;
        const claim = parseClaim(reply.body);
        if (claim === null || claim.requestId !== requestId) return invalidResponse();
        if (!claim.claimed) return { ok: true, result: { requestId, notifiedAt: claim.notifiedAt, sent: false } };
        try {
            await options.send(regionCapacityMessage(claim, options.siteUrl, options));
        } catch (error) {
            log(`Region request notification failed for ${requestId}: ${error instanceof Error ? error.message : "unknown error"}`);
            await release(call, claim, log);
            return { ok: false, status: 502, error: {
                code: "notification_failed", message: "The notification email could not be sent. Try again.", retryable: true,
            } };
        }
        return { ok: true, result: { requestId, notifiedAt: claim.notifiedAt, sent: true } };
    };
}

// Clears a claim whose email failed; a failed release only leaves the request marked notified.
async function release(call: ControlPlaneCall, claim: Claim, log: (message: string) => void) {
    try {
        const reply = await call("release-region-request-notification", { requestId: claim.requestId, notifiedAt: claim.notifiedAt });
        if (envelopeError(reply) !== null) log(`Region request notification release was rejected for ${claim.requestId}`);
    } catch {
        log(`Region request notification release failed for ${claim.requestId}`);
    }
}

// Passes a control-plane error envelope through unchanged, or returns null for a success envelope.
function envelopeError(reply: ControlPlaneReply): RegionRequestNotificationOutcome | null {
    const body = reply.body;
    if (!isRecord(body) || typeof body.ok !== "boolean") return invalidResponse();
    if (body.ok) return null;
    const error = body.error;
    if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string") return invalidResponse();
    return { ok: false, status: reply.status, error: { code: error.code, message: error.message, retryable: error.retryable === true } };
}

// Reads the target request ID from an input that must be exactly `{ requestId: <uuid> }`.
function parseInput(input: unknown): string | null {
    if (!isRecord(input) || Object.keys(input).length !== 1) return null;
    const { requestId } = input;
    return typeof requestId === "string" && UUID.test(requestId) ? requestId.toLowerCase() : null;
}

// Reads the claim result from a success envelope; the recipient address is validated by the SMTP sender,
// whose rejection takes the release path, so a won claim is never left stuck here.
function parseClaim(body: unknown): Claim | null {
    if (!isRecord(body) || !isRecord(body.result)) return null;
    const { requestId, region, requesterEmail, notifiedAt, claimed } = body.result;
    if (typeof requestId !== "string" || typeof region !== "string" || typeof requesterEmail !== "string"
        || typeof notifiedAt !== "string" || typeof claimed !== "boolean") return null;
    return { requestId, region, requesterEmail, notifiedAt, claimed };
}

// Describes an unparseable control-plane reply.
function invalidResponse(): RegionRequestNotificationOutcome {
    return { ok: false, status: 502, error: { code: "invalid_response", message: "The control plane returned an invalid response.", retryable: true } };
}

// Narrows an unknown value to a plain object.
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
