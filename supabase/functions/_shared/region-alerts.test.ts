import assert from "node:assert/strict";
import test from "node:test";
import {
    createRegionAlerts, parseRecipients, regionFullAlertMessage, regionRequestAlertMessage, requesterFromToken, resolveRegionAlertConfig,
    type RegionAlertSettings, type RegionFullEvent, type RegionRequestedEvent,
} from "./region-alerts.ts";
import type { SmtpMessage } from "./smtp.ts";

const ACCOUNT_ID = "abcdefab-1111-4111-8111-111111111111";
const event: RegionRequestedEvent = {
    requestId: "abcdefab-2222-4222-8222-222222222222", region: "france", createdAt: "2026-09-07T14:00:00.000Z",
    requester: { accountId: ACCOUNT_ID, email: "owner@example.test" },
};
const full: RegionFullEvent = {
    region: "us-east", serverId: "abcdefab-3333-4333-8333-333333333333", createdAt: "2026-09-07T15:00:00.000Z",
    requester: { accountId: ACCOUNT_ID, email: "owner@example.test" },
};
const settings: RegionAlertSettings = {
    recipients: ["Admin@example.test", "second@example.test"], from: "alerts@example.test",
    smtp: { hostname: "smtp.example.test", port: 465, username: "alerts@example.test" },
};
const withSmtp = (smtp: Partial<RegionAlertSettings["smtp"]>, rest: Partial<RegionAlertSettings> = {}): RegionAlertSettings =>
    ({ ...settings, ...rest, smtp: { ...settings.smtp, ...smtp } });
const secret = (password: string | undefined) => (name: string) => (name === "SMTP_PASS" ? password : undefined);
const token = (claims: unknown) => `header.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.signature`;

test("recipients are trimmed, lowercased, deduplicated and validated", () => {
    assert.deepEqual(parseRecipients([" A@example.test ", "b@example.test", "a@example.test", ""]), ["a@example.test", "b@example.test"]);
    for (const values of [[], [" "], ["not-an-address"], ["a@example.test", "bad"], Array.from({ length: 21 }, (_, i) => `u${i}@example.test`)]) {
        assert.throws(() => parseRecipients(values), /Alert recipient/u);
    }
});

test("alert configuration validates committed settings and is disabled only by a missing SMTP_PASS", () => {
    assert.equal(resolveRegionAlertConfig(settings, secret(undefined)), null);
    assert.equal(resolveRegionAlertConfig(settings, secret("  ")), null);
    assert.deepEqual(resolveRegionAlertConfig(settings, secret("hunter2")), {
        recipients: ["admin@example.test", "second@example.test"], from: "alerts@example.test",
        smtp: { hostname: "smtp.example.test", port: 465, tls: "implicit", username: "alerts@example.test", password: "hunter2" },
    });
    assert.equal(resolveRegionAlertConfig(withSmtp({}, { fromName: " Bannerlord Coop " }), secret("x"))?.fromName, "Bannerlord Coop");
    assert.equal(resolveRegionAlertConfig(withSmtp({ port: 2525 }), secret("x"))?.smtp.tls, "starttls");
    assert.equal(resolveRegionAlertConfig(withSmtp({ port: 2525, tls: "implicit" }), secret("x"))?.smtp.tls, "implicit");
    for (const [invalid, pattern] of [
        [withSmtp({ port: 587 }), /blocked by Supabase/u], [withSmtp({ port: 25 }), /blocked by Supabase/u], [withSmtp({ port: 0 }), /SMTP port/u], [withSmtp({ port: 465.5 }), /SMTP port/u],
        [withSmtp({ hostname: "smtp.example.test/path" }), /SMTP hostname/u], [withSmtp({ hostname: "localhost" }), /SMTP hostname/u], [withSmtp({ hostname: " " }), /SMTP hostname/u],
        [withSmtp({ username: " " }), /SMTP username/u], [withSmtp({ tls: "none" as "implicit" }), /SMTP tls/u],
        [withSmtp({}, { from: "bad" }), /Alert sender/u], [withSmtp({}, { recipients: ["nope"] }), /Alert recipient/u], [withSmtp({}, { recipients: [] }), /Alert recipients/u],
        [withSmtp({}, { fromName: " " }), /Alert sender name/u], [withSmtp({}, { fromName: "Coop\r\nBcc: x@y.z" }), /Alert sender name/u], [withSmtp({}, { fromName: "x".repeat(101) }), /Alert sender name/u],
    ] as const) {
        // Invalid committed settings must fail even when the password is absent.
        assert.throws(() => resolveRegionAlertConfig(invalid, secret(undefined)), pattern);
        assert.throws(() => resolveRegionAlertConfig(invalid, secret("x")), pattern);
    }
});

test("requester identity is read from verified JWT claims only when well-formed", () => {
    assert.deepEqual(requesterFromToken(token({ sub: ACCOUNT_ID, email: " Owner@Example.test " })), { accountId: ACCOUNT_ID, email: "owner@example.test" });
    assert.deepEqual(requesterFromToken(token({ sub: "not-a-uuid", email: "not-an-email" })), { accountId: null, email: null });
    assert.deepEqual(requesterFromToken(token({ sub: ACCOUNT_ID })), { accountId: ACCOUNT_ID, email: null });
    assert.deepEqual(requesterFromToken(token([ACCOUNT_ID])), { accountId: null, email: null });
    for (const value of ["synthetic-jwt-for-contract-tests-only", "a.b", "a..c", `a.${"x".repeat(20_000)}.c`, "a.!!!.c", `a.${Buffer.from("null").toString("base64url")}.c`]) {
        assert.deepEqual(requesterFromToken(value), { accountId: null, email: null });
    }
});

test("alert message names the region, requester and durable request", () => {
    const message = regionRequestAlertMessage(event, { from: "alerts@example.test", fromName: "Bannerlord Coop", recipients: ["admin@example.test"] });
    assert.equal(message.from, "alerts@example.test");
    assert.equal(message.fromName, "Bannerlord Coop");
    assert.equal("fromName" in regionRequestAlertMessage(event, { from: "alerts@example.test", recipients: ["admin@example.test"] }), false);
    assert.deepEqual(message.to, ["admin@example.test"]);
    assert.equal(message.subject, "[BannerlordCoop] Server region request: France");
    for (const line of ["Region: France (france)", `Requested by: owner@example.test (account ${ACCOUNT_ID})`, `Request ID: ${event.requestId}`, "Created: 2026-09-07T14:00:00.000Z", "consumed no quota"]) {
        assert.ok(message.text.includes(line), line);
    }
    const anonymous = regionRequestAlertMessage({ ...event, region: "united-kingdom", requester: { accountId: null, email: null } }, { from: "alerts@example.test", recipients: ["admin@example.test"] });
    assert.equal(anonymous.subject, "[BannerlordCoop] Server region request: United Kingdom");
    assert.ok(anonymous.text.includes("Requested by: unknown email (account unknown)"));
});

test("full-region alert names the region and the server that used its last slot", () => {
    const message = regionFullAlertMessage(full, { from: "alerts@example.test", recipients: ["admin@example.test"] });
    assert.equal(message.subject, "[BannerlordCoop] Server region full: US-East");
    for (const line of ["Region: US-East (us-east)", `Server ID: ${full.serverId}`, `Created by: owner@example.test (account ${ACCOUNT_ID})`, "Created: 2026-09-07T15:00:00.000Z"]) {
        assert.ok(message.text.includes(line), line);
    }
});

test("alert hooks send to every recipient and never throw", async () => {
    const sent: SmtpMessage[] = []; const logged: string[] = [];
    const alerts = createRegionAlerts({ recipients: ["admin@example.test", "second@example.test"], from: "alerts@example.test", send: async (message) => { sent.push(message); }, log: (line) => logged.push(line) });
    await alerts.regionRequested(event);
    await alerts.regionFull(full);
    assert.deepEqual(sent.map((message) => message.subject), ["[BannerlordCoop] Server region request: France", "[BannerlordCoop] Server region full: US-East"]);
    assert.deepEqual(sent[0].to, ["admin@example.test", "second@example.test"]);
    assert.equal(logged.length, 0);

    const failing = createRegionAlerts({ recipients: ["admin@example.test"], from: "alerts@example.test", send: async () => { throw new Error("535 bad credentials"); }, log: (line) => logged.push(line) });
    await failing.regionRequested(event);
    await failing.regionFull(full);
    assert.deepEqual(logged, [`Region alert failed for request ${event.requestId}: 535 bad credentials`, "Region alert failed for full region us-east: 535 bad credentials"]);
});
