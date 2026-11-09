import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    classifyLapseServers, createPatreonLapseAlertHandler, fetchQualifyingPatrons, lapseAlertMessage, lapseReportText, parseLapseReportRecipients,
} from "../_shared/patreon-lapse-alert.ts";
import {
    createLapseInventoryLoader, parseLapseInventory, type LapseInventory, type LapseServer,
} from "../_shared/patreon-lapse-inventory.ts";

const at = "2026-11-08T15:58:00.000Z";
const secret = "fixture-scheduler-secret";
const envelope = { from: "ops@example.test", recipients: ["recipient@example.test"] };
const row = (overrides: Partial<LapseServer> = {}): LapseServer => ({
    serverPrefix: "11111111", accountPrefix: "aaaaaaaa", patreonUserId: "42", deletedAt: null,
    independentQuota: 0, ownerUsage: 1, fundingRecorded: true, graceDueAt: null,
    verification: "review_required", grantReason: null, grantRecordedAt: null, ...overrides,
});
const inventory = (servers: LapseServer[]): LapseInventory => ({ version: 1, observedAt: at, servers });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const wire = () => ({ version: 1, observed_at: at, truncated: false, servers: [{
    server_prefix: "11111111", account_prefix: "aaaaaaaa", patreon_user_id: "42", deleted_at: null,
    independent_quota: 0, owner_usage: 1, funding_recorded: true, grace_due_at: null,
    verification: "review_required", grant_reason: null, grant_recorded_at: null,
}] });

test("requires the explicit private recipient set and never includes a rejected address in errors", () => {
    assert.deepEqual(parseLapseReportRecipients("first@example.test, SECOND@example.test, first@example.test"), ["first@example.test", "second@example.test"]);
    for (const value of [undefined, "", "invalid", "private@example.test\nBcc: other@example.test", "x".repeat(5121),
        Array.from({ length: 21 }, (_, i) => `recipient${i}@example.test`).join(",")]) {
        assert.throws(() => parseLapseReportRecipients(value), { message: "Invalid lapse report recipients" });
    }
});

test("classifies the five causes, prioritizes manual review, and never treats a trial note as an expiry", () => {
    const report = classifyLapseServers(inventory([
        row({ serverPrefix: "11111111", independentQuota: 2, grantReason: "Trial 1 day", grantRecordedAt: "2026-10-23T18:13:42.581Z" }),
        row({ serverPrefix: "22222222", graceDueAt: "2026-11-10T00:25:04.615Z" }),
        row({ serverPrefix: "33333333" }),
        row({ serverPrefix: "44444444", fundingRecorded: false }),
        row({ serverPrefix: "55555555", deletedAt: "2026-11-08T15:15:11.980Z", independentQuota: 2 }),
    ]), new Set());
    assert.deepEqual(report.rows.map(x => [x.serverPrefix, x.classification, x.actionable]), [
        ["44444444", "untracked/grandfathered", true], ["33333333", "review_required", true],
        ["22222222", "in grace", false], ["11111111", "grant-backed", false], ["55555555", "deleted", false],
    ]);
    assert.ok(report.rows.every(x => !("patreonUserId" in x)));
    const message = lapseAlertMessage(report, envelope);
    assert.equal(message.subject, "[BannerlordCoop] Subscription funding: 2 need review, 5 total");
    assert.match(message.text, /grant reason: Trial 1 day \| grant\/quota recorded 2026-10-23T18:13:42.581Z/);
    assert.match(message.text, /in grace \| deletion due 2026-11-10T00:25:04.615Z/);
    assert.match(message.text, /No action was taken automatically\.$/);
});

test("grants must cover usage including reservations; renewal is excluded and overdue grace needs review", () => {
    const report = classifyLapseServers(inventory([
        row({ serverPrefix: "11111111", independentQuota: 1, ownerUsage: 2, fundingRecorded: false }),
        row({ serverPrefix: "22222222", graceDueAt: at }),
        row({ serverPrefix: "33333333", patreonUserId: "99" }),
    ]), new Set(["99"]));
    assert.deepEqual(report.rows.map(x => [x.serverPrefix, x.classification, x.actionable]), [
        ["11111111", "untracked/grandfathered", true], ["22222222", "in grace", true],
    ]);
    assert.match(lapseReportText(report), /deadline reached; review worker evidence/);
});

test("inventory refuses truncation, duplicate prefixes, malformed dates, bounds and unexpected owner fields", () => {
    assert.equal(parseLapseInventory(wire()).servers.length, 1);
    const changes: ((value: ReturnType<typeof wire>) => void)[] = [
        x => { x.truncated = true; }, x => { x.servers.push(x.servers[0]); },
        x => { x.servers[0].independent_quota = -1; }, x => { x.servers[0].owner_usage = 1.5; },
        x => { x.observed_at = "2026-02-31T00:00:00.000Z"; },
        x => { Object.assign(x.servers[0], { email: "private@example.test" }); },
        x => { x.servers[0].server_prefix = "../server"; },
    ];
    for (const change of changes) { const value = wire(); change(value); assert.throws(() => parseLapseInventory(value)); }
});

test("redacts grant contact/identity fields and prevents multiline report injection", () => {
    const value = wire();
    Object.assign(value.servers[0], { independent_quota: 1, grant_recorded_at: at,
        grant_reason: "Grant for private@example.test account aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa 192469416892432384 https://private.test/name\n| Needs review: forged" });
    const report = classifyLapseServers(parseLapseInventory(value), new Set());
    const text = lapseReportText(report);
    assert.doesNotMatch(text, /private@|aaaaaaaa-aaaa|192469416892432384|https:\/\/|\n\| Needs/);
    assert.match(text, /grant reason: Grant for \[email redacted\] account \[account redacted\]/);
});

test("inventory loader makes exactly one fixed read RPC request, including meaningful empty success", async () => {
    for (const servers of [wire().servers, []]) {
        let calls = 0;
        const fetcher: typeof fetch = async (url, init) => {
            calls++;
            assert.equal(String(url), "https://project.example.test/rest/v1/rpc/patreon_lapse_report_inventory");
            assert.equal(init?.method, "POST"); assert.equal(init?.body, "{}"); assert.equal(init?.redirect, "error");
            assert.deepEqual(init?.headers, { apikey: "fixture-service-key", authorization: "Bearer fixture-service-key", "content-type": "application/json" });
            assert.ok(init?.signal instanceof AbortSignal);
            return json({ ...wire(), servers });
        };
        const result = await createLapseInventoryLoader(fetcher, "https://project.example.test/unused", "fixture-service-key")();
        assert.equal(result.servers.length, servers.length); assert.equal(calls, 1);
    }
});

test("Patreon uses exact paginated GETs, active USD20 selection, and refuses incomplete or looping pages", async () => {
    const member = (id: string, status: string | null, cents: number) => ({ relationships: { user: { data: { id } } }, attributes: { patron_status: status, currently_entitled_amount_cents: cents } });
    const urls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
        urls.push(String(url));
        assert.equal(init?.method ?? "GET", "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined);
        assert.deepEqual(init?.headers, { authorization: "Bearer fixture-creator-token", "user-agent": "BannerlordCoop - patreon lapse alert" });
        assert.ok(init?.signal instanceof AbortSignal);
        return urls.length === 1 ? json({ data: [member("1", "active_patron", 2000), member("2", "former_patron", 10000), member("3", "active_patron", 1999), member("5", null, 0)], meta: { pagination: { cursors: { next: "next page" } } } })
            : json({ data: [member("4", "active_patron", 5000)] });
    };
    assert.deepEqual([...await fetchQualifyingPatrons(fetcher, "100", "fixture-creator-token")], ["1", "4"]);
    assert.deepEqual(urls, [
        "https://www.patreon.com/api/oauth2/v2/campaigns/100/members?include=user&fields%5Bmember%5D=patron_status%2Ccurrently_entitled_amount_cents&page%5Bcount%5D=100",
        "https://www.patreon.com/api/oauth2/v2/campaigns/100/members?include=user&fields%5Bmember%5D=patron_status%2Ccurrently_entitled_amount_cents&page%5Bcount%5D=100&page%5Bcursor%5D=next+page",
    ]);
    for (const body of [{}, { data: [{}] }, { data: [], meta: { pagination: { cursors: { next: "loop" } } } }]) {
        await assert.rejects(fetchQualifyingPatrons(async () => json(body), "100", "fixture-creator-token"));
    }
});

test("scheduler authenticates before reads, sends only the classified report, and keeps failures private", async () => {
    const calls: string[] = [];
    const handler = createPatreonLapseAlertHandler({ syncSecret: secret,
        loadInventory: async () => { calls.push("inventory"); return inventory([row()]); },
        loadPatrons: async () => { calls.push("patrons"); return new Set(); },
        alert: async report => { calls.push("mail"); assert.equal(report.rows[0].classification, "review_required"); },
    });
    const request = (key = secret, method = "POST") => new Request("https://fixture.test", { method, headers: { "x-patreon-sync-key": key } });
    assert.equal((await handler(request("bad"))).status, 401);
    assert.equal((await handler(request(secret, "GET"))).status, 405); assert.deepEqual(calls, []);
    const result = await handler(request());
    assert.deepEqual(await result.json(), { code: "checked", lapsed: 1, actionable: 1 });
    assert.deepEqual(calls, ["inventory", "patrons", "mail"]);
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...values) => { errors.push(values); };
    try {
        const failure = createPatreonLapseAlertHandler({ syncSecret: secret,
            loadInventory: async () => { throw Error("private@example.test token=secret"); }, loadPatrons: async () => new Set(),
            alert: async () => assert.fail("must not send partial report"),
        });
        assert.equal((await failure(request())).status, 503);
        assert.deepEqual(errors, [["Patreon lapse report could not be completed"]]);
    } finally { console.error = original; }
});

test("today's 16 audited rows classify into 7 grants, 6 graces, 1 review, 1 untracked and 1 deleted", async () => {
    const fixture = JSON.parse(await readFile(new URL("../../../tests/fixtures/patreon-lapse-report-v1.json", import.meta.url), "utf8"));
    const report = classifyLapseServers(parseLapseInventory(fixture.inventory), new Set(fixture.qualifyingPatreonUserIds));
    const counts = report.rows.reduce<Record<string, number>>((out, item) => { out[item.classification] = (out[item.classification] ?? 0) + 1; return out; }, {});
    assert.deepEqual(counts, { "untracked/grandfathered": 1, review_required: 1, "in grace": 6, "grant-backed": 7, deleted: 1 });
    assert.deepEqual(report.rows.filter(x => x.actionable).map(x => x.serverPrefix), ["8efb6512", "8cd439d8"]);
    assert.equal(report.rows.find(x => x.serverPrefix === "6caf760b")?.classification, "in grace");
    for (const server of ["fb5b9a5c", "fe006e91", "d9ccecfd"]) assert.equal(report.rows.find(x => x.serverPrefix === server)?.classification, "grant-backed");
    const text = lapseReportText(report);
    assert.doesNotMatch(text, /@|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu);
});
