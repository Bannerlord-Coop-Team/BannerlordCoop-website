import assert from "node:assert/strict";
import test from "node:test";
import { createRegionRequestNotifier, regionCapacityMessage, type ControlPlaneCall } from "./region-request-notification.ts";
import type { SmtpMessage } from "./smtp.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NOTIFIED_AT = "2026-10-10T12:00:00.000Z";
const SENDER = { from: "admin@bannerlordcoop.com", fromName: "Bannerlord Coop" };

// Answers claim and release calls with the given claim result and records every call.
function controlPlane(claimed: boolean, calls: Array<{ operation: string; input: Record<string, unknown> }>): ControlPlaneCall {
    return async (operation, input) => {
        calls.push({ operation, input });
        if (operation === "release-region-request-notification") {
            return { status: 200, body: { version: 1, ok: true, result: { requestId: REQUEST_ID, released: true } } };
        }
        return { status: 200, body: { version: 1, ok: true, result: {
            requestId: REQUEST_ID, region: "united-kingdom", requesterEmail: "owner@example.com", notifiedAt: NOTIFIED_AT, claimed,
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
    const notify = createRegionRequestNotifier({ ...SENDER, send: async (message) => { sent.push(message); } });
    const outcome = await notify({ requestId: REQUEST_ID, siteOrigin: "https://bannerlordcoop.com", call: controlPlane(true, calls) });
    assert.deepEqual(outcome, { ok: true, result: { requestId: REQUEST_ID, notifiedAt: NOTIFIED_AT, sent: true } });
    assert.equal(sent.length, 1);
    assert.deepEqual(calls.map((call) => call.operation), ["claim-region-request-notification"]);
});

test("sends nothing when an earlier notification holds the claim", async () => {
    let sends = 0; const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    const notify = createRegionRequestNotifier({ ...SENDER, send: async () => { sends += 1; } });
    const outcome = await notify({ requestId: REQUEST_ID, siteOrigin: "https://bannerlordcoop.com", call: controlPlane(false, calls) });
    assert.deepEqual(outcome, { ok: true, result: { requestId: REQUEST_ID, notifiedAt: NOTIFIED_AT, sent: false } });
    assert.equal(sends, 0);
});

test("releases the exact claim and reports a retryable failure when the email fails", async () => {
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = []; const logs: string[] = [];
    const notify = createRegionRequestNotifier({ ...SENDER, send: async () => { throw new Error("SMTP timeout"); }, log: (line) => logs.push(line) });
    const outcome = await notify({ requestId: REQUEST_ID, siteOrigin: "https://bannerlordcoop.com", call: controlPlane(true, calls) });
    assert.deepEqual(outcome, { ok: false, status: 502, error: {
        code: "notification_failed", message: "The notification email could not be sent. Try again.", retryable: true,
    } });
    assert.deepEqual(calls[1], { operation: "release-region-request-notification", input: { requestId: REQUEST_ID, notifiedAt: NOTIFIED_AT } });
    assert.match(logs[0] ?? "", /SMTP timeout/u);
});

test("passes a control-plane claim error through without sending", async () => {
    let sends = 0;
    const notify = createRegionRequestNotifier({ ...SENDER, send: async () => { sends += 1; } });
    const outcome = await notify({ requestId: REQUEST_ID, siteOrigin: "https://bannerlordcoop.com", call: async () => ({
        status: 409, body: { version: 1, ok: false, error: { code: "conflict", message: "Region request has no requester email", retryable: false } },
    }) });
    assert.deepEqual(outcome, { ok: false, status: 409, error: { code: "conflict", message: "Region request has no requester email", retryable: false } });
    assert.equal(sends, 0);
});

test("rejects a malformed claim result without sending", async () => {
    let sends = 0;
    const notify = createRegionRequestNotifier({ ...SENDER, send: async () => { sends += 1; } });
    const outcome = await notify({ requestId: REQUEST_ID, siteOrigin: "https://bannerlordcoop.com", call: async () => ({
        status: 200, body: { version: 1, ok: true, result: { requestId: REQUEST_ID, claimed: true } },
    }) });
    assert.equal(outcome.ok, false);
    assert.equal(sends, 0);
});
