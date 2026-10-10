import assert from "node:assert/strict";
import test from "node:test";
import { createRegionRequestNotifier, regionCapacityMessage, type ControlPlaneCall } from "./region-request-notification.ts";
import { sendSmtpMail, type SmtpMessage } from "./smtp.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NOTIFIED_AT = "2026-10-10T12:00:00.000Z";
const SENDER = { from: "admin@bannerlordcoop.com", fromName: "Bannerlord Coop" };
const OPTIONS = { ...SENDER, siteUrl: "https://bannerlordcoop.com" };

// Answers claim and release calls with the given claim result and records every call.
function controlPlane(
    claimed: boolean,
    calls: Array<{ operation: string; input: Record<string, unknown> }>,
    requesterEmail = "owner@example.com",
): ControlPlaneCall {
    return async (operation, input) => {
        calls.push({ operation, input });
        if (operation === "release-region-request-notification") {
            return { status: 200, body: { version: 1, ok: true, result: { requestId: REQUEST_ID, released: true } } };
        }
        return { status: 200, body: { version: 1, ok: true, result: {
            requestId: REQUEST_ID, region: "united-kingdom", requesterEmail, notifiedAt: NOTIFIED_AT, claimed,
        } } };
    };
}

test("emails the requester the region label and the servers page", () => {
    const message = regionCapacityMessage({ region: "united-kingdom", requesterEmail: "owner@example.com" }, "https://bannerlordcoop.com", SENDER);
    assert.deepEqual(message.to, ["owner@example.com"]);
    assert.equal(message.subject, "[BannerlordCoop] Server capacity available: United Kingdom");
    assert.match(message.text, /available in United Kingdom/u);
    assert.match(message.text, /https:\/\/bannerlordcoop\.com\/servers/u);
    assert.equal(message.fromName, "Bannerlord Coop");
});

test("sends exactly one email after a successful claim", async () => {
    const sent: SmtpMessage[] = []; const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    const notify = createRegionRequestNotifier({ ...OPTIONS, send: async (message) => { sent.push(message); } });
    const outcome = await notify({ requestId: REQUEST_ID }, controlPlane(true, calls));
    assert.deepEqual(outcome, { ok: true, result: { requestId: REQUEST_ID, notifiedAt: NOTIFIED_AT, sent: true } });
    assert.equal(sent.length, 1);
    assert.deepEqual(calls.map((call) => call.operation), ["claim-region-request-notification"]);
});

test("sends nothing when an earlier notification holds the claim", async () => {
    let sends = 0; const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    const notify = createRegionRequestNotifier({ ...OPTIONS, send: async () => { sends += 1; } });
    const outcome = await notify({ requestId: REQUEST_ID }, controlPlane(false, calls));
    assert.deepEqual(outcome, { ok: true, result: { requestId: REQUEST_ID, notifiedAt: NOTIFIED_AT, sent: false } });
    assert.equal(sends, 0);
});

test("releases the exact claim and reports a retryable failure when the email fails", async () => {
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = []; const logs: string[] = [];
    const notify = createRegionRequestNotifier({ ...OPTIONS, send: async () => { throw new Error("SMTP timeout"); }, log: (line) => logs.push(line) });
    const outcome = await notify({ requestId: REQUEST_ID }, controlPlane(true, calls));
    assert.deepEqual(outcome, { ok: false, status: 502, error: {
        code: "notification_failed", message: "The notification email could not be sent. Try again.", retryable: true,
    } });
    assert.deepEqual(calls[1], { operation: "release-region-request-notification", input: { requestId: REQUEST_ID, notifiedAt: NOTIFIED_AT } });
    assert.match(logs[0] ?? "", /SMTP timeout/u);
});

test("passes a control-plane claim error through without sending", async () => {
    let sends = 0;
    const notify = createRegionRequestNotifier({ ...OPTIONS, send: async () => { sends += 1; } });
    const outcome = await notify({ requestId: REQUEST_ID }, async () => ({
        status: 409, body: { version: 1, ok: false, error: { code: "conflict", message: "Region request has no requester email", retryable: false } },
    }));
    assert.deepEqual(outcome, { ok: false, status: 409, error: { code: "conflict", message: "Region request has no requester email", retryable: false } });
    assert.equal(sends, 0);
});

test("rejects a malformed claim result without sending", async () => {
    let sends = 0;
    const notify = createRegionRequestNotifier({ ...OPTIONS, send: async () => { sends += 1; } });
    const outcome = await notify({ requestId: REQUEST_ID }, async () => ({
        status: 200, body: { version: 1, ok: true, result: { requestId: REQUEST_ID, claimed: true } },
    }));
    assert.equal(outcome.ok, false);
    assert.equal(sends, 0);
});

test("releases a won claim when the SMTP sender rejects the requester address", async () => {
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    const logs: string[] = [];
    const refuseConnections = async () => { throw new Error("SMTP must reject the recipient before connecting"); };
    const notify = createRegionRequestNotifier({ ...OPTIONS, log: (line) => logs.push(line), send: (message) => sendSmtpMail(
        { connect: refuseConnections, connectTls: refuseConnections, startTls: refuseConnections },
        { hostname: "smtp.example.test", port: 465, tls: "implicit", username: "resend", password: "secret" },
        message,
    ) });
    const outcome = await notify({ requestId: REQUEST_ID }, controlPlane(true, calls, "o'neil@example.com"));
    assert.equal(outcome.ok, false);
    assert.deepEqual(calls.map((call) => call.operation), ["claim-region-request-notification", "release-region-request-notification"]);
    assert.match(logs[0] ?? "", /Invalid recipient address/u);
});

test("rejects any input other than exactly one request UUID without calling the control plane", async () => {
    let called = 0;
    const notify = createRegionRequestNotifier({ ...OPTIONS, send: async () => undefined });
    for (const input of [undefined, null, [], {}, { requestId: "not-a-uuid" }, { requestId: REQUEST_ID, extra: true }]) {
        const outcome = await notify(input, async () => { called += 1; return { status: 200, body: {} }; });
        assert.deepEqual(outcome, { ok: false, status: 400, error: { code: "invalid_request", message: "The request is invalid.", retryable: false } });
    }
    assert.equal(called, 0);
});
