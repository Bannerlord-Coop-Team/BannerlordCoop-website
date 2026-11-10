import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createLapseInventoryLoader, parseLapseInventory } from "../_shared/patreon-lapse-inventory.ts";
import { classifyLapseServers } from "../_shared/patreon-lapse-alert.ts";

// Existing column/usage definitions from CP 33a693c01471b3ebd10b8e8afc945b0292f089e2.
// Execute the real append-only Website RPC migration, without a production connection.
const schema = `
create role anon; create role authenticated; create role service_role;
create schema control_plane;
create table control_plane.managed_servers(server_id text primary key, guild_id text, owner_discord_user_id text, soft_deleted_at text, operation_state text);
create table control_plane.hosting_entitlements(guild_id text, discord_user_id text, base_quota bigint, bonus_quota bigint, updated_at text);
create table control_plane.hosting_website_accounts(account_id text, principal_id text);
create table public.patreon_accounts(user_id uuid, patreon_user_id text);
create table control_plane.hosting_subscription_grace(server_id text primary key, owner_id text, grace_id text, due_at text, campaign_id text);
create table control_plane.hosting_membership_sources(account_id text, guild_id text, campaign_key text, snapshot_json text, updated_at text);
create table control_plane.hosting_jobs(job_id text primary key, state text);
create table control_plane.hosting_role_restoration_authorizations(server_id text, restoration_job_id text, consumed_at text, invalidated_at text);
create table control_plane.audit_events(audit_sequence bigint primary key, target_discord_user_id text, action text, reason text, occurred_at text);
create table control_plane.hosting_history_audit_facts(like control_plane.audit_events);
create view control_plane.hosting_audit_event_reads with (security_invoker=true) as
  select * from control_plane.audit_events union all select * from control_plane.hosting_history_audit_facts;
create function public.patreon_lapse_server_owners() returns integer language sql as $$ select 7 $$;
`;
const migration = readFile(new URL("../../migrations/202611080001_patreon_lapse_report_inventory.sql", import.meta.url), "utf8");
const linksMigration = readFile(new URL("../../migrations/202611090002_patreon_lapse_report_links.sql", import.meta.url), "utf8");
const owner = "supabase:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const server = "11111111-1111-4111-8111-111111111111";

async function database(): Promise<PGlite> {
    const db = new PGlite(); await db.exec(schema); return db;
}
async function read(db: PGlite) {
    return (await db.query<{ inventory: unknown }>("select public.patreon_lapse_report_inventory() inventory")).rows[0].inventory;
}
async function readV2(db: PGlite) {
    return (await db.query<{ inventory: unknown }>("select public.patreon_lapse_report_inventory_v2() inventory")).rows[0].inventory;
}
async function state(db: PGlite) {
    const snapshot: Record<string, unknown> = {};
    for (const table of ["managed_servers", "hosting_entitlements", "hosting_website_accounts", "hosting_subscription_grace", "hosting_membership_sources", "hosting_jobs", "hosting_role_restoration_authorizations", "audit_events", "hosting_history_audit_facts"]) {
        snapshot[table] = (await db.query(`select * from control_plane.${table}`)).rows;
    }
    snapshot.patreon_accounts = (await db.query("select * from public.patreon_accounts")).rows;
    return snapshot;
}

test("UUID migration replays read-only, retains v1 byte-for-byte and changes no classification, redaction, state or callers", async () => {
    const db = await database();
    try {
        const deleted = new Date(Date.now() - 60_000).toISOString();
        await db.query("insert into control_plane.managed_servers values($1,'guild',$2,null,'running'),('22222222-2222-4222-8222-222222222222','guild',$2,$3,'deleted'),('33333333-3333-4333-8333-333333333333','guild','unbound',null,'stopped'),('44444444-4444-4444-8444-444444444444','guild',$2,null,'deleted')", [server, owner, deleted]);
        await db.query("insert into control_plane.hosting_website_accounts values($1,$2)", [account, owner]);
        await db.query("insert into control_plane.hosting_entitlements values('guild',$1,3,0,'2026-10-23T18:13:42.581Z')", [owner]);
        await db.query("insert into control_plane.audit_events values(1,$1,'hosting.admin.quota_changed','Trial private@example.test https://private.test','2026-10-23T18:13:42.581Z')", [owner]);
        await db.exec(await migration);
        const beforeState = await state(db);
        const v1 = await read(db);
        await db.exec(await linksMigration); await db.exec(await linksMigration);
        await db.exec("begin read only; set local role service_role");
        const raw = await readV2(db);
        const v2 = parseLapseInventory(raw);
        await db.exec("rollback");
        assert.deepEqual(await state(db), beforeState);
        // The old signature remains deployable while the new one is commissioned.
        const afterV1 = await read(db);
        assert.equal(JSON.stringify(afterV1).replace(/"observed_at":"[^"]+"/u, '"observed_at":"CLOCK"'),
            JSON.stringify(v1).replace(/"observed_at":"[^"]+"/u, '"observed_at":"CLOCK"'));
        const original = parseLapseInventory(v1);
        assert.equal(v2.version, 2);
        const factsOnly = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !["serverId", "accountId"].includes(key)));
        assert.deepEqual(v2.servers.map(factsOnly), original.servers);
        const report = classifyLapseServers(v2, new Set());
        assert.deepEqual(report.rows.map(factsOnly), classifyLapseServers(original, new Set()).rows);
        assert.equal(v2.servers[0].serverId, server); assert.equal(v2.servers[0].accountId, account);
        assert.equal(v2.servers[1].serverId, null);
        assert.equal(v2.servers[2].accountId, null);
        assert.equal(v2.servers[3].serverId, null);
        assert.equal(v2.servers[3].deletedAt, null);
        assert.doesNotMatch(JSON.stringify(v2), /private@|private\.test/);
        for (const role of ["anon", "authenticated"]) {
            await db.exec(`set role ${role}`); await assert.rejects(readV2(db), /permission denied/u); await db.exec("reset role");
        }
        await db.exec("set role service_role");
        await assert.rejects(db.query("select * from control_plane.managed_servers"), /permission denied/u);
        await assert.rejects(db.query("select * from public.patreon_lapse_report_grants(true)"), /permission denied/u);
        await db.exec("reset role");
    } finally { await db.close(); }
});

test("RPC upgrades/replays without changing state, preserves the old report and runs in a read-only transaction", async () => {
    const db = await database();
    try {
        const deleted = new Date(Date.now() - 60_000).toISOString();
        await db.query("insert into control_plane.managed_servers values($1,'guild',$2,null,'suspended'),('22222222-2222-4222-8222-222222222222','guild',$2,$3,'deleted')", [server, owner, deleted]);
        await db.query("insert into control_plane.hosting_entitlements values('guild',$1,1,1,'2026-10-23T18:13:42.581Z')", [owner]);
        await db.query("insert into control_plane.hosting_website_accounts values($1,$2)", [account, owner]);
        await db.query("insert into public.patreon_accounts values($1,'42')", [account]);
        await db.query("insert into control_plane.hosting_subscription_grace values($1,$2,'grace','2026-11-10T00:00:00.000Z','100')", [server, owner]);
        await db.query("insert into control_plane.hosting_membership_sources values($1,'guild','100','{\"verification\":\"nonqualifying\"}','2026-11-08T12:00:00.000Z')", [account]);
        await db.query("insert into control_plane.audit_events values(1,$1,'hosting.admin.quota_changed','Earlier grant','2026-10-22T18:13:42.581Z')", [owner]);
        await db.query("insert into control_plane.hosting_history_audit_facts values(2,$1,'hosting.admin.quota_changed','Trial 1 day','2026-10-23T18:13:42.581Z')", [owner]);
        const before = await state(db);
        await db.exec(await migration); await db.exec(await migration);
        await db.exec("begin read only; set local role service_role;");
        const inventory = parseLapseInventory(await read(db));
        await db.exec("rollback");
        assert.deepEqual(await state(db), before);
        assert.equal((await db.query<{ value: number }>("select public.patreon_lapse_server_owners() value")).rows[0].value, 7);
        assert.equal(inventory.servers.length, 2);
        assert.deepEqual(inventory.servers[0], {
            serverPrefix: "11111111", accountPrefix: "aaaaaaaa", patreonUserId: "42", deletedAt: null,
            independentQuota: 2, ownerUsage: 1, fundingRecorded: true, graceDueAt: "2026-11-10T00:00:00.000Z",
            verification: "nonqualifying", grantReason: "Trial 1 day", grantRecordedAt: "2026-10-23T18:13:42.581Z",
        });
        assert.deepEqual(classifyLapseServers(inventory, new Set()).rows.map(row => row.classification), ["grant-backed", "deleted"]);
        for (const role of ["anon", "authenticated"]) {
            await db.exec(`set role ${role}`); await assert.rejects(read(db), /permission denied/u); await db.exec("reset role");
        }
        await db.exec("set role service_role");
        await assert.rejects(db.query("select * from control_plane.managed_servers"), /permission denied/u);
        await assert.rejects(db.query("select * from public.patreon_lapse_report_grants(true)"), /permission denied/u);
        await db.exec("reset role");
    } finally { await db.close(); }
});

test("the same report reads primary grant history before archival and retained facts after view commissioning", async () => {
    const db = await database();
    try {
        await db.exec("drop view control_plane.hosting_audit_event_reads");
        await db.query("insert into control_plane.managed_servers values($1,'guild',$2,null,'stopped')", [server, owner]);
        await db.query("insert into control_plane.hosting_entitlements values('guild',$1,1,0,'2026-10-23T18:13:42.581Z')", [owner]);
        await db.query("insert into control_plane.audit_events values(1,$1,'hosting.admin.quota_changed','Primary grant','2026-10-23T18:13:42.581Z')", [owner]);
        await db.exec(await migration);
        assert.equal(parseLapseInventory(await read(db)).servers[0].grantReason, "Primary grant");
        await db.exec(`create view control_plane.hosting_audit_event_reads with (security_invoker=true) as
            select * from control_plane.audit_events union all select * from control_plane.hosting_history_audit_facts`);
        await db.query("insert into control_plane.hosting_history_audit_facts values(2,$1,'hosting.admin.quota_changed','Retained grant','2026-10-24T18:13:42.581Z')", [owner]);
        assert.equal(parseLapseInventory(await read(db)).servers[0].grantReason, "Retained grant");
    } finally { await db.close(); }
});

test("skips the grant-history batch when no candidate has independent quota", async () => {
    const db = await database();
    try {
        await db.query("insert into control_plane.managed_servers values($1,'guild',$2,null,'running')", [server, owner]);
        await db.query("insert into control_plane.hosting_entitlements values('guild',$1,0,0,'2026-10-23T18:13:42.581Z')", [owner]);
        await db.exec(await migration);
        await db.exec(`create or replace function public.patreon_lapse_report_grants(include_grants boolean)
            returns table(owner_id text, reason text, occurred_at text) language plpgsql stable strict rows 1000
            as $$ begin raise exception 'unexpected grant-history read'; end $$`);
        assert.equal(parseLapseInventory(await read(db)).servers[0].grantReason, null);
        await db.exec("update control_plane.hosting_entitlements set base_quota = 1");
        await assert.rejects(read(db), /unexpected grant-history read/u);
    } finally { await db.close(); }
});

test("usage includes live allocations and distinct active restoration reservations, excluding old deleted context", async () => {
    const db = await database();
    try {
        const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
        await db.query("insert into control_plane.managed_servers values($1,'guild',$2,null,'stopped'),('22222222-2222-4222-8222-222222222222','guild',$2,$3,'deleted')", [server, owner, old]);
        await db.query("insert into control_plane.hosting_entitlements values('guild',$1,0,1,'2026-10-23T18:13:42.581Z')", [owner]);
        await db.exec("insert into control_plane.hosting_jobs values('active','queued'),('terminal','succeeded');");
        await db.query("insert into control_plane.hosting_role_restoration_authorizations values('22222222-2222-4222-8222-222222222222','active',null,null),('22222222-2222-4222-8222-222222222222','active',null,null),($1,'terminal',null,null)", [server]);
        await db.exec(await migration);
        const inventory = parseLapseInventory(await read(db));
        assert.equal(inventory.servers.length, 1);
        assert.equal(inventory.servers[0].ownerUsage, 2);
        assert.equal(classifyLapseServers(inventory, new Set()).rows[0].classification, "untracked/grandfathered");
    } finally { await db.close(); }
});

test("a new owner never inherits funding/grace, and multiple source campaigns cannot duplicate a row", async () => {
    const db = await database();
    try {
        await db.query("insert into control_plane.managed_servers values($1,'guild',$2,null,'running')", [server, owner]);
        await db.query("insert into control_plane.hosting_website_accounts values($1,$2)", [account, owner]);
        await db.query("insert into control_plane.hosting_subscription_grace values($1,'old-owner','old-grace','2026-11-10T00:00:00.000Z','100')", [server]);
        await db.query("insert into control_plane.hosting_membership_sources values($1,'guild','100','{\"verification\":\"unknown\"}','2026-11-07T12:00:00.000Z'),($1,'guild','200','{\"verification\":\"review_required\"}','2026-11-08T12:00:00.000Z')", [account]);
        await db.exec(await migration);
        const inventory = parseLapseInventory(await read(db));
        assert.equal(inventory.servers.length, 1);
        assert.equal(inventory.servers[0].fundingRecorded, false);
        assert.equal(inventory.servers[0].graceDueAt, null);
        assert.equal(inventory.servers[0].verification, "review_required");
    } finally { await db.close(); }
});

test("overflow is explicit and refused, while an empty result remains valid", async () => {
    const db = await database();
    try {
        await db.exec(await migration);
        assert.equal(parseLapseInventory(await read(db)).servers.length, 0);
        await db.exec(`insert into control_plane.managed_servers
            select lpad(to_hex(n),8,'0') || '-0000-4000-8000-000000000000', 'guild','owner',null,'stopped' from generate_series(1,1001) n`);
        const raw = await read(db) as { truncated: boolean; servers: unknown[] };
        assert.equal(raw.truncated, true); assert.equal(raw.servers.length, 1000);
        assert.throws(() => parseLapseInventory(raw), /incomplete/u);
    } finally { await db.close(); }
});

test("the real RPC output round-trips through the HTTP loader for nonempty and empty results", async () => {
    const db = await database();
    const requests: string[] = [];
    const http = createServer(async (request, response) => {
        try {
            assert.equal(request.method, "POST");
            assert.equal(request.url, "/rest/v1/rpc/patreon_lapse_report_inventory_v2");
            assert.equal(request.headers.authorization, "Bearer fixture-service-key");
            assert.equal(request.headers.apikey, "fixture-service-key");
            assert.equal(request.headers["content-type"], "application/json");
            let body = "";
            for await (const chunk of request) { body += String(chunk); assert.ok(body.length <= 16); }
            assert.equal(body, "{}"); requests.push(body);
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(await readV2(db)));
        } catch { response.writeHead(500); response.end(); }
    });
    try {
        await db.exec(await migration);
        await db.exec(await linksMigration);
        await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
        const address = http.address();
        assert.ok(address && typeof address !== "string");
        const load = createLapseInventoryLoader(fetch, `http://127.0.0.1:${address.port}`, "fixture-service-key");
        assert.equal((await load()).servers.length, 0);
        await db.query("insert into control_plane.managed_servers values($1,'guild',$2,null,'running')", [server, owner]);
        const result = classifyLapseServers(await load(), new Set());
        assert.equal(result.rows[0].classification, "untracked/grandfathered");
        assert.equal(result.rows[0].serverPrefix, "11111111");
        assert.equal(result.rows[0].serverId, server);
        assert.deepEqual(requests, ["{}", "{}"]);
    } finally {
        await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
        await db.close();
    }
});
