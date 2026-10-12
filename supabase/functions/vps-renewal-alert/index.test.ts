import assert from "node:assert/strict";
import test from "node:test";
import {
    checkVpsRenewals, createVpsRenewalAlertHandler, createVpsRenewalHostLoader, parseVpsRenewalHosts,
    vpsRenewalAlertMessage, type VpsRenewalCheck, type VpsRenewalHost,
} from "../_shared/vps-renewal-alert.ts";

const syncSecret = "scheduler-secret-for-fixtures";
const now = new Date("2026-10-11T14:00:00.000Z");
const envelope = { from: "admin@bannerlordcoop.com", fromName: "Bannerlord Coop", recipients: ["ops@example.com"] };

// A fresh, idle, registered auto-renewing VPS renewing in three days unless overridden.
function host(overrides: Partial<VpsRenewalHost> = {}): VpsRenewalHost {
    return {
        serviceName: "vps-idle.vps.ovh.us", expirationDate: "2026-10-15T00:00:00.000Z", autoRenew: true,
        observedAt: "2026-10-11T12:00:00.000Z", registered: true, usedSlots: 0, ...overrides,
    };
}

function scheduled(key = syncSecret, method = "POST") {
    return new Request("https://example.test/functions/v1/vps-renewal-alert", { method, headers: { "x-patreon-sync-key": key } });
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
    assert.equal(check.snapshotProblem, null);
});

test("reports an empty or stale snapshot instead of staying silent", () => {
    assert.match(checkVpsRenewals([], now).snapshotProblem ?? "", /No VPS renewal data/u);
    assert.equal(checkVpsRenewals([host({ observedAt: "2026-10-10T02:00:00.000Z" })], now).snapshotProblem, null);
    assert.match(checkVpsRenewals([host({ observedAt: "2026-10-10T01:59:59.999Z" })], now).snapshotProblem ?? "",
        /2026-10-10T01:59:59.999Z, more than 36 hours ago/u);
});

test("the email lists each idle VPS with time left, renewal mode and registration", () => {
    const check = checkVpsRenewals([
        host(),
        host({ serviceName: "vps-manual", autoRenew: false, registered: false }),
        host({ serviceName: "vps-passed", expirationDate: "2026-10-11T13:59:59.999Z", autoRenew: null }),
    ], now);
    const message = vpsRenewalAlertMessage(check, now, envelope);
    assert.equal(message.subject, "[BannerlordCoop] 3 unused VPS(es) renew within 5 days");
    assert.deepEqual(message.to, ["ops@example.com"]);
    assert.equal(message.fromName, "Bannerlord Coop");
    assert.equal(message.text, [
        "These VPSes have no slots assigned to a server and renew within 5 days:",
        "",
        "- vps-idle.vps.ovh.us | renews 2026-10-15T00:00:00.000Z (in 3 day(s)) | auto-renews",
        "- vps-manual | renews 2026-10-15T00:00:00.000Z (in 3 day(s)) | manual renewal: renew it in OVHcloud to keep it, otherwise it expires | not registered as a control-plane host",
        "- vps-passed | renews 2026-10-11T13:59:59.999Z (date has passed) | renewal mode unknown",
        "",
        "No action was taken automatically. Cancelling, renewing or resizing a VPS is a manual OVHcloud operation.",
    ].join("\n"));
});

test("a stale snapshot email leads with the warning and marks any list as older data", () => {
    const stale = host({ observedAt: "2026-10-09T00:00:00.000Z" });
    const withIdle = vpsRenewalAlertMessage(checkVpsRenewals([stale], now), now, envelope);
    assert.equal(withIdle.subject, "[BannerlordCoop] VPS renewals could not be verified");
    assert.match(withIdle.text, /^WARNING: The newest VPS renewal data was recorded at 2026-10-09T00:00:00.000Z.*\nThe list below comes from that older data\.\n\nThese VPSes/u);
    const empty = vpsRenewalAlertMessage(checkVpsRenewals([], now), now, envelope);
    assert.equal(empty.text, [
        "WARNING: No VPS renewal data has been recorded by the control plane. The control plane may be unable to read the OVHcloud account.",
        "",
        "No action was taken automatically. Cancelling, renewing or resizing a VPS is a manual OVHcloud operation.",
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

test("the loader calls only the service-role RPC and fails on an error status", async () => {
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
});

test("the handler authenticates the scheduler, emails only when needed and reports failures", async () => {
    const sent: VpsRenewalCheck[] = [];
    let hosts: VpsRenewalHost[] = [host({ usedSlots: 2 })];
    const handler = createVpsRenewalAlertHandler({
        syncSecret, now: () => now,
        loadHosts: async () => hosts,
        alert: async (check) => { sent.push(check); },
    });
    assert.equal((await handler(scheduled("wrong-secret"))).status, 401);
    assert.equal((await handler(scheduled(syncSecret, "GET"))).status, 405);
    assert.deepEqual(await (await handler(scheduled())).json(), { code: "checked", idle: 0, stale: false });
    assert.equal(sent.length, 0);
    hosts = [host()];
    assert.deepEqual(await (await handler(scheduled())).json(), { code: "checked", idle: 1, stale: false });
    hosts = [];
    assert.deepEqual(await (await handler(scheduled())).json(), { code: "checked", idle: 0, stale: true });
    assert.equal(sent.length, 2);

    const failing = createVpsRenewalAlertHandler({
        syncSecret, now: () => now, loadHosts: async () => [host()],
        alert: async () => { throw new Error("smtp unavailable"); },
    });
    const originalError = console.error;
    console.error = () => undefined;
    try {
        const response = await failing(scheduled());
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { code: "check_failed" });
    } finally { console.error = originalError; }
});
