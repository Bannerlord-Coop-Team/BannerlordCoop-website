import assert from "node:assert/strict";
import test from "node:test";
import {
    checkVpsRenewals, createVpsRenewalAlertHandler, createVpsRenewalHostLoader, parseVpsRenewalHosts,
    vpsRenewalAlertMessage, type VpsRenewalCheck, type VpsRenewalHost,
} from "../_shared/vps-renewal-alert.ts";

const syncSecret = "scheduler-secret-for-fixtures";
const now = new Date("2026-10-11T14:00:00.000Z");
const envelope = { from: "admin@bannerlordcoop.com", fromName: "Bannerlord Co-op", recipients: ["ops@example.com"] };
const footer = "No action was taken automatically. Cancelling, renewing or resizing a VPS is a manual OVHcloud operation.";

// A fresh, idle, registered auto-renewing VPS renewing in three days unless overridden.
function host(overrides: Partial<VpsRenewalHost> = {}): VpsRenewalHost {
    return {
        serviceName: "vps-idle.vps.ovh.us", expirationDate: "2026-10-15T00:00:00.000Z", autoRenew: true,
        observedAt: "2026-10-11T12:00:00.000Z", registered: true, usedSlots: 0, ...overrides,
    };
}

// Builds a scheduler request to the function with the given key and method.
function scheduled(key = syncSecret, method = "POST") {
    return new Request("https://example.test/functions/v1/vps-renewal-alert", { method, headers: { "x-patreon-sync-key": key } });
}

// Runs the body with console.error captured into the returned lines, restoring it afterwards.
async function capturingErrors(body: () => Promise<void>): Promise<string[]> {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => { logged.push(line); };
    try { await body(); } finally { console.error = originalError; }
    return logged;
}

test("alerts only for VPSes with no used slots renewing within five days, including passed and manual ones", () => {
    const check = checkVpsRenewals([
        host(),
        host({ serviceName: "vps-used", usedSlots: 1 }),
        host({ serviceName: "vps-edge", expirationDate: "2026-10-16T14:00:00.000Z" }),
        host({ serviceName: "vps-later", expirationDate: "2026-10-16T14:00:00.001Z" }),
        host({ serviceName: "vps-unknown-date", expirationDate: null }),
        host({ serviceName: "vps-passed", expirationDate: "2026-10-10T00:00:00.000Z", autoRenew: false }),
        host({ serviceName: "vps-unregistered", registered: false, autoRenew: null }),
    ], now);
    assert.deepEqual(check.idle.map((entry) => entry.serviceName), ["vps-idle.vps.ovh.us", "vps-edge", "vps-passed", "vps-unregistered"]);
    assert.equal(check.snapshot, "fresh");
    assert.equal(check.newestObservedAt, "2026-10-11T12:00:00.000Z");
});

test("reports an empty or stale snapshot instead of staying silent", () => {
    assert.deepEqual(checkVpsRenewals([], now), { idle: [], snapshot: "empty", newestObservedAt: null });
    assert.equal(checkVpsRenewals([host({ observedAt: "2026-10-10T02:00:00.000Z" })], now).snapshot, "fresh");
    const stale = checkVpsRenewals([
        host({ observedAt: "2026-10-10T01:59:59.999Z" }),
        host({ serviceName: "vps-older", observedAt: "2026-10-09T00:00:00.000Z" }),
    ], now);
    assert.equal(stale.snapshot, "stale");
    assert.equal(stale.newestObservedAt, "2026-10-10T01:59:59.999Z");
});

test("the email lists each idle VPS with time left, renewal mode and registration", () => {
    const check = checkVpsRenewals([
        host(),
        host({ serviceName: "vps-manual", autoRenew: false, registered: false }),
        host({ serviceName: "vps-today", expirationDate: "2026-10-12T13:59:59.999Z" }),
        host({ serviceName: "vps-one-day", expirationDate: "2026-10-12T14:00:00.000Z" }),
        host({ serviceName: "vps-passed", expirationDate: "2026-10-11T13:59:59.999Z", autoRenew: null }),
    ], now);
    const message = vpsRenewalAlertMessage(check, now, envelope);
    assert.equal(message.subject, "[BannerlordCoop] 5 unused VPS(es) renew within 5 days");
    assert.deepEqual(message.to, ["ops@example.com"]);
    assert.equal(message.fromName, "Bannerlord Co-op");
    assert.equal(message.text, [
        "These VPSes have no slots assigned to a server and renew within 5 days:",
        "",
        "- vps-idle.vps.ovh.us | renews 2026-10-15T00:00:00.000Z (in 3 day(s)) | auto-renews",
        "- vps-manual | renews 2026-10-15T00:00:00.000Z (in 3 day(s)) | manual renewal: renew it in OVHcloud to keep it, otherwise it expires | not registered as a control-plane host",
        "- vps-today | renews 2026-10-12T13:59:59.999Z (within 24 hours) | auto-renews",
        "- vps-one-day | renews 2026-10-12T14:00:00.000Z (in 1 day(s)) | auto-renews",
        "- vps-passed | renews 2026-10-11T13:59:59.999Z (date has passed) | renewal mode unknown",
        "",
        footer,
    ].join("\n"));
});

test("an unverified snapshot email leads with the warning and marks any list as older data", () => {
    const stale = host({ observedAt: "2026-10-09T00:00:00.000Z" });
    const withIdle = vpsRenewalAlertMessage(checkVpsRenewals([stale], now), now, envelope);
    assert.equal(withIdle.subject, "[BannerlordCoop] VPS renewals could not be verified");
    assert.match(withIdle.text, /^WARNING: The newest VPS renewal data was recorded at 2026-10-09T00:00:00.000Z, more than 36 hours ago\..*\nThe list below comes from that older data\.\n\nThese VPSes/u);
    const empty = vpsRenewalAlertMessage(checkVpsRenewals([], now), now, envelope);
    assert.equal(empty.text, [
        "WARNING: No VPS renewal data has been recorded by the control plane. The control plane may be unable to read the OVHcloud account.",
        "",
        footer,
    ].join("\n"));
    const unreadable = vpsRenewalAlertMessage({ idle: [], snapshot: "unreadable", newestObservedAt: null }, now, envelope);
    assert.equal(unreadable.subject, "[BannerlordCoop] VPS renewals could not be verified");
    assert.equal(unreadable.text, [
        "WARNING: The VPS renewal data could not be read from the control plane. Check the vps-renewal-alert function logs.",
        "",
        footer,
    ].join("\n"));
});

test("parses RPC rows and rejects any malformed row", () => {
    const row = { service_name: "vps-a.vps.ovh.us", expiration_date: "2026-10-15T00:00:00.000Z", auto_renew: false,
        observed_at: "2026-10-11T12:00:00.000Z", registered: true, used_slots: 0 };
    assert.deepEqual(parseVpsRenewalHosts([row]), [{ serviceName: "vps-a.vps.ovh.us", expirationDate: "2026-10-15T00:00:00.000Z",
        autoRenew: false, observedAt: "2026-10-11T12:00:00.000Z", registered: true, usedSlots: 0 }]);
    for (const bad of [
        { service_name: "" }, { service_name: "../etc" }, { expiration_date: "2026-10-15" }, { auto_renew: 1 },
        { observed_at: null }, { registered: "yes" }, { used_slots: -1 }, { used_slots: 0.5 },
    ]) assert.throws(() => parseVpsRenewalHosts([{ ...row, ...bad }]), /invalid/u, JSON.stringify(bad));
    assert.throws(() => parseVpsRenewalHosts({ rows: [] }), /invalid/u);
    assert.throws(() => parseVpsRenewalHosts([null]), /invalid/u);
    assert.throws(() => parseVpsRenewalHosts(Array.from({ length: 257 }, () => row)), /invalid/u);
});

test("the loader calls only the service-role RPC and fails on an error status or an oversized body", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return Response.json([]);
    }) as typeof fetch;
    assert.deepEqual(await createVpsRenewalHostLoader(fetcher, "https://project.supabase.co", "service-key")(), []);
    assert.equal(calls[0]?.url, "https://project.supabase.co/rest/v1/rpc/vps_renewal_alert_hosts");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer service-key");
    const failing = (async () => new Response("missing", { status: 404 })) as typeof fetch;
    await assert.rejects(createVpsRenewalHostLoader(failing, "https://project.supabase.co", "service-key")(), /404/u);
    const oversized = (async () => Response.json(["x".repeat(131_072)])) as typeof fetch;
    await assert.rejects(createVpsRenewalHostLoader(oversized, "https://project.supabase.co", "service-key")(), /too large/u);
});

test("the handler rejects a missing, short or oversized scheduler secret at creation", () => {
    const options = { now: () => now, loadHosts: async () => [], alert: async () => undefined };
    for (const bad of ["", "x".repeat(15), "x".repeat(4097)]) {
        assert.throws(() => createVpsRenewalAlertHandler({ ...options, syncSecret: bad }), /invalid_vps_renewal_sync_secret/u);
    }
    assert.doesNotThrow(() => createVpsRenewalAlertHandler({ ...options, syncSecret: "x".repeat(16) }));
    assert.doesNotThrow(() => createVpsRenewalAlertHandler({ ...options, syncSecret: "x".repeat(4096) }));
});

test("the handler authenticates the scheduler, emails only when needed and reports failed delivery", async () => {
    const sent: VpsRenewalCheck[] = [];
    let hosts: VpsRenewalHost[] = [host({ usedSlots: 2 })];
    const handler = createVpsRenewalAlertHandler({
        syncSecret, now: () => now,
        loadHosts: async () => hosts,
        alert: async (check) => { sent.push(check); },
    });
    assert.equal((await handler(scheduled("wrong-secret"))).status, 401);
    assert.equal((await handler(scheduled(syncSecret, "GET"))).status, 405);
    assert.deepEqual(await (await handler(scheduled())).json(), { code: "checked", idle: 0, snapshot: "fresh" });
    assert.equal(sent.length, 0);
    hosts = [host()];
    assert.deepEqual(await (await handler(scheduled())).json(), { code: "checked", idle: 1, snapshot: "fresh" });
    hosts = [];
    assert.deepEqual(await (await handler(scheduled())).json(), { code: "checked", idle: 0, snapshot: "empty" });
    assert.equal(sent.length, 2);

    const failing = createVpsRenewalAlertHandler({
        syncSecret, now: () => now, loadHosts: async () => [host()],
        alert: async () => { throw new Error("smtp unavailable"); },
    });
    const logged = await capturingErrors(async () => {
        const response = await failing(scheduled());
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { code: "alert_failed" });
    });
    assert.deepEqual(logged, ["VPS renewal alert could not be delivered: smtp unavailable"]);
});

test("an unreadable snapshot still sends the could-not-verify warning and fails only if that email fails", async () => {
    const sent: VpsRenewalCheck[] = [];
    const handler = createVpsRenewalAlertHandler({
        syncSecret, now: () => now,
        loadHosts: async () => { throw new Error("VPS renewal row is invalid"); },
        alert: async (check) => { sent.push(check); },
    });
    const logged = await capturingErrors(async () => {
        const response = await handler(scheduled());
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { code: "checked", idle: 0, snapshot: "unreadable" });
    });
    assert.deepEqual(sent, [{ idle: [], snapshot: "unreadable", newestObservedAt: null }]);
    assert.deepEqual(logged, ["VPS renewal snapshot could not be read: VPS renewal row is invalid"]);

    const undeliverable = createVpsRenewalAlertHandler({
        syncSecret, now: () => now,
        loadHosts: async () => { throw new Error("VPS renewal query failed with 500"); },
        alert: async () => { throw new Error("smtp unavailable"); },
    });
    await capturingErrors(async () => {
        const response = await undeliverable(scheduled());
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { code: "alert_failed" });
    });
});
