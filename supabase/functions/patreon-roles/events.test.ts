import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createPatreonRoleHandler } from "../_shared/patreon-roles.ts";

const campaign = "12345", tier = "28995946", patreonUser = "123";
const member = "11111111-1111-4111-8111-111111111111";
const otherMember = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const endpoint = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/patreon-roles";
const syncSecret = "fixture-scheduler-secret", webhookSecret = "fixture-webhook-secret";
type Lease = { token: string; jobs: { memberId: string; generation: number }[]; scanGeneration: number; scanDue: boolean; cursor: string };
let db: PGlite;

before(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key,email_confirmed_at timestamptz,
            deleted_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb default '{}',updated_at timestamptz default now());
        create schema vault;
        create table vault.decrypted_secrets(name text,decrypted_secret text);
        create schema net;
        create table net.requests(id bigint generated always as identity primary key,url text,headers jsonb,body jsonb,timeout_ms integer);
        create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000)
        returns bigint language sql as $$
            insert into net.requests(url,headers,body,timeout_ms) values(url,headers,body,timeout_milliseconds) returning id;
        $$;`);
    for (const name of ["20260907212654_create_patreon_links", "20260907220000_patreon_website_roles", "20260908030000_patreon_event_reconciliation"]) {
        await db.exec(await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8"));
    }
});
after(async () => { await db?.close(); });
beforeEach(async () => {
    await db.exec("reset role; truncate patreon_roles.audit,patreon_roles.grants,patreon_roles.memberships,patreon_roles.sync_state,auth.users,net.requests,vault.decrypted_secrets cascade");
    await db.query("insert into vault.decrypted_secrets values ('patreon_roles_function_url',$1),('patreon_roles_sync_secret',$2)", [endpoint, syncSecret]);
    await db.query("insert into patreon_roles.sync_state(campaign_id,tier_id,scan_due) values($1,$2,now()+interval '6 hours')", [campaign, tier]);
    await db.query("insert into auth.users(id,email_confirmed_at,raw_app_meta_data) values($1,now(),'{\"role\":\"User\"}')", [user]);
});

async function rpc(operation: string, input: Record<string, unknown> = {}) {
    return (await db.query<{ result: unknown }>("select public.patreon_role_sync($1,$2,$3,$4::jsonb) as result",
        [campaign, tier, operation, JSON.stringify(input)])).rows[0].result;
}
async function enable() { await db.exec("update patreon_roles.sync_state set dispatch_enabled=true"); }
async function dispatch() { return (await db.query<{ id: number | null }>("select patreon_roles.dispatch() as id")).rows[0].id; }
async function requests() { return (await db.query<{ url: string; body: object; headers: Record<string, string>; timeout_ms: number }>("select url,body,headers,timeout_ms from net.requests order by id")).rows; }
async function link(identity = patreonUser) {
    await db.query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,$2) on conflict(user_id) do update set patreon_user_id=excluded.patreon_user_id", [user, identity]);
}
async function known(id = member, identity = patreonUser) {
    await db.query("insert into patreon_roles.memberships(member_id,patreon_user_id,due_at) values($1,$2,'infinity')", [id, identity]);
}
async function role() { return (await db.query<{ role: string }>("select raw_app_meta_data->>'role' as role from auth.users where id=$1", [user])).rows[0].role; }
function snapshot(id = member, identity = patreonUser, eligible = true) {
    return { data: { type: "member", id,
        attributes: { is_free_trial: false, is_gifted: false, last_charge_status: "Paid" },
        relationships: { campaign: { data: { type: "campaign", id: campaign } }, user: { data: { type: "user", id: identity } },
            currently_entitled_tiers: { data: eligible ? [{ type: "tier", id: tier }] : [] } },
    } };
}
function handler(fetchImplementation: typeof fetch = async () => Response.json(snapshot())) {
    return createPatreonRoleHandler({ campaignId: campaign, tierId: tier, creatorAccessToken: "fixture-creator-token", syncSecret, webhookSecret, rpc, fetchImplementation });
}
async function runWorker(worker = handler()) {
    return worker(new Request(endpoint, { method: "POST", headers: { "x-patreon-sync-key": syncSecret } }));
}

test("link commit wakes the authenticated worker and grants without a cron tick", async () => {
    await known(); await enable();
    await db.exec("set role service_role"); await link(); await db.exec("reset role");
    assert.equal(await role(), "User");
    assert.deepEqual(await requests(), [{ url: endpoint, body: {}, headers: { "Content-Type": "application/json", "X-Patreon-Sync-Key": syncSecret }, timeout_ms: 60000 }]);
    assert.equal((await runWorker()).status, 200);
    assert.equal(await role(), "Standard Server");
    assert.equal((await requests()).length, 1);
    assert.equal(await dispatch(), null);
    assert.equal((await db.query<{ six_hours: boolean }>("select due_at between now()+interval '359 minutes' and now()+interval '361 minutes' as six_hours from patreon_roles.memberships")).rows[0].six_hours, true);
});

test("signed membership changes wake reconciliation and revoke using current API evidence", async () => {
    await known(); await enable(); await link(); await runWorker();
    const body = JSON.stringify(snapshot(member, patreonUser, false));
    const worker = handler(async () => Response.json(snapshot(member, patreonUser, false)));
    const event = () => worker(new Request(endpoint, { method: "POST", body, headers: {
        "x-patreon-event": "members:pledge:delete", "x-patreon-signature": createHmac("md5", webhookSecret).update(body).digest("hex"),
    } }));
    await event(); await event();
    assert.equal((await requests()).length, 2);
    assert.equal(await role(), "Standard Server");
    await runWorker(worker);
    assert.equal(await role(), "User");
});

test("transaction rollback removes the link, durable work and HTTP enqueue together", async () => {
    await known(); await enable();
    await db.exec("begin"); await link(); assert.equal((await requests()).length, 1); await db.exec("rollback");
    assert.equal((await requests()).length, 0);
    assert.equal((await db.query("select * from public.patreon_accounts")).rows.length, 0);
    assert.equal(await dispatch(), null);
});

test("idle recovery and disabled dispatch issue no external requests", async () => {
    await known(); await rpc("queue", { memberId: member });
    assert.equal((await requests()).length, 0);
    await db.exec("update patreon_roles.memberships set due_at='infinity'"); await enable();
    for (let i = 0; i < 4; i++) assert.equal(await dispatch(), null);
    assert.equal((await requests()).length, 0);
});

test("duplicate events coalesce and a lost HTTP wakeup becomes recoverable", async () => {
    await known(); await enable();
    await rpc("queue", { memberId: member }); await rpc("queue", { memberId: member });
    assert.equal((await requests()).length, 1);
    assert.equal(await dispatch(), null);
    await db.exec("update patreon_roles.sync_state set dispatch_until=now()-interval '1 second'");
    assert.ok(await dispatch()); assert.equal((await requests()).length, 2);
});

test("an event during a worker lease is not lost and release wakes the next worker", async () => {
    await known(); await enable(); await rpc("queue", { memberId: member });
    const lease = await rpc("acquire") as Lease;
    await rpc("queue", { memberId: member });
    assert.equal((await requests()).length, 1);
    assert.deepEqual(await rpc("complete", { token: lease.token, ...lease.jobs[0], userId: patreonUser, eligible: true }), { stale: true });
    await rpc("release", { token: lease.token });
    assert.equal((await requests()).length, 2);
});

test("expired worker lease and deferred failed jobs can recover without an event", async () => {
    await known(); await enable(); await rpc("queue", { memberId: member });
    const lease = await rpc("acquire") as Lease;
    await rpc("failed", { token: lease.token, ...lease.jobs[0] });
    await rpc("release", { token: lease.token });
    assert.equal((await requests()).length, 1);
    await db.exec("update patreon_roles.sync_state set dispatch_enabled=false");
    await db.exec("update patreon_roles.memberships set due_at=now()-interval '1 second'");
    await enable(); assert.ok(await dispatch());
    const next = await rpc("acquire") as Lease;
    assert.ok(next.token);
    await db.exec("update patreon_roles.sync_state set worker_until=now()-interval '1 second'");
    await db.exec("update patreon_roles.memberships set due_at=now()");
    assert.equal((await requests()).length, 3);
});

test("a fresh linked account is first even with more than a batch of older work", async () => {
    for (let i = 0; i < 25; i++) {
        await db.query("insert into patreon_roles.memberships(member_id,due_at) values($1,now()-interval '1 hour')", [`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`]);
    }
    await known(); await enable(); await link();
    const lease = await rpc("acquire") as Lease;
    assert.equal(lease.jobs.length, 20); assert.equal(lease.jobs[0].memberId, member);
});

test("three worker starts per rolling minute bound chained reads and leave work durable", async () => {
    await known(); await enable();
    for (let i = 0; i < 3; i++) {
        await rpc("queue", { memberId: member });
        const lease = await rpc("acquire") as Lease; assert.ok(lease);
        await rpc("release", { token: lease.token });
    }
    await rpc("queue", { memberId: member });
    assert.equal(await rpc("acquire"), null); assert.equal(await dispatch(), null);
    assert.equal((await requests()).length, 3);
    await db.exec("update patreon_roles.sync_state set recent_runs=array[now()-interval '61 seconds',now()-interval '30 seconds',now()-interval '10 seconds']");
    assert.ok(await dispatch()); assert.ok(await rpc("acquire"));
    assert.equal(await rpc("acquire"), null);
});

test("missing or unsafe Vault configuration never rolls back a successful account link", async () => {
    for (const value of ["https://attacker.example/collect", "http://abcdefghijklmnopqrst.supabase.co/functions/v1/patreon-roles", endpoint + "?redirect=evil", null]) {
        await db.query("update vault.decrypted_secrets set decrypted_secret=$1 where name='patreon_roles_function_url'", [value]);
        await known(); await enable(); await link();
        assert.equal((await requests()).length, 0);
        assert.equal((await db.query<{ dispatch_error: string }>("select dispatch_error from patreon_roles.sync_state")).rows[0].dispatch_error, "dispatch_unavailable");
        await db.exec("delete from public.patreon_accounts; delete from patreon_roles.memberships");
    }
    await db.query("update vault.decrypted_secrets set decrypted_secret=$1 where name='patreon_roles_function_url'", [endpoint]);
    await known(); await link();
    assert.equal((await requests()).length, 1);
});

test("browser roles cannot dispatch, read credentials or enable event delivery", async () => {
    for (const name of ["anon", "authenticated", "service_role"]) {
        await db.exec(`set role ${name}`);
        await assert.rejects(() => dispatch());
        await assert.rejects(() => db.exec("update patreon_roles.sync_state set dispatch_enabled=true"));
        await assert.rejects(() => db.exec("select * from vault.decrypted_secrets"));
        await db.exec("reset role");
    }
});

test("unknown links restart a fenced scan, map identities and check only linked members", async () => {
    await db.exec("update patreon_roles.sync_state set cursor='old-page',scan_pages=2");
    await enable(); await link();
    let lease = await rpc("acquire") as Lease;
    assert.equal(lease.cursor, ""); assert.equal(lease.scanDue, true);
    const members = [{ memberId: member, userId: patreonUser }, { memberId: otherMember, userId: "999" }];
    await rpc("discovered", { token: lease.token, scanGeneration: lease.scanGeneration, memberIds: members.map(m => m.memberId), members, cursor: "" });
    await rpc("release", { token: lease.token });
    assert.equal((await requests()).length, 2);
    lease = await rpc("acquire") as Lease;
    assert.deepEqual(lease.jobs.map(m => m.memberId), [member]);
    await rpc("complete", { token: lease.token, ...lease.jobs[0], userId: patreonUser, eligible: true });
    await rpc("release", { token: lease.token });
    assert.equal(await role(), "Standard Server");
});

test("discovery mappings cannot overwrite identity, accept duplicates or discard queued events", async () => {
    await known(); await rpc("queue", { memberId: member });
    const lease = await rpc("acquire") as Lease;
    const input = { token: lease.token, scanGeneration: lease.scanGeneration, memberIds: [member], members: [{ memberId: member, userId: "999" }], cursor: "" };
    await assert.rejects(() => rpc("discovered", input));
    await assert.rejects(() => rpc("discovered", { ...input, members: [] }));
    await assert.rejects(() => rpc("discovered", { ...input, memberIds: [member, member], members: [input.members[0], input.members[0]] }));
    await rpc("queue", { memberId: member });
    await rpc("discovered", { ...input, members: [{ memberId: member, userId: patreonUser }] });
    await rpc("release", { token: lease.token });
    assert.deepEqual((await rpc("acquire") as Lease).jobs.map(m => m.memberId), [member]);
});

test("unlinked members stop periodic reads while linked ineligible members retain recovery checks", async () => {
    await known(); await rpc("queue", { memberId: member }); await runWorker();
    assert.equal((await db.query<{ infinite: boolean }>("select due_at='infinity'::timestamptz as infinite from patreon_roles.memberships")).rows[0].infinite, true);
    await link(); await runWorker(handler(async () => Response.json(snapshot(member, patreonUser, false))));
    assert.equal((await db.query<{ finite: boolean }>("select isfinite(due_at) as finite from patreon_roles.memberships")).rows[0].finite, true);
    assert.equal(await role(), "User");
});

test("upgrade preserves live grants, pending work and successful periodic deadlines", async () => {
    const upgrade = new PGlite();
    try {
        await upgrade.exec(`create role anon; create role authenticated; create role service_role bypassrls;
            create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz,
                deleted_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb default '{}',updated_at timestamptz default now());`);
        for (const name of ["20260907212654_create_patreon_links", "20260907220000_patreon_website_roles"]) {
            await upgrade.exec(await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8"));
        }
        await upgrade.query("insert into auth.users(id,email_confirmed_at,raw_app_meta_data) values($1,now(),'{\"role\":\"User\"}')", [user]);
        await upgrade.query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,$2)", [user, patreonUser]);
        const call = async (operation: string, input: object = {}) => (await upgrade.query<{ result: unknown }>(
            "select public.patreon_role_sync($1,$2,$3,$4::jsonb) as result", [campaign, tier, operation, JSON.stringify(input)],
        )).rows[0].result;
        await call("queue", { memberId: member });
        const lease = await call("acquire") as Lease;
        await call("complete", { token: lease.token, ...lease.jobs[0], userId: patreonUser, eligible: true });
        await call("release", { token: lease.token });
        await call("queue", { memberId: otherMember });
        const before = await upgrade.query("select raw_app_meta_data from auth.users");
        const deadlines = await upgrade.query("select member_id,due_at::text from patreon_roles.memberships order by member_id");
        await upgrade.exec(await readFile(new URL("../../migrations/20260908030000_patreon_event_reconciliation.sql", import.meta.url), "utf8"));
        assert.deepEqual((await upgrade.query("select raw_app_meta_data from auth.users")).rows, before.rows);
        assert.equal((await upgrade.query("select * from patreon_roles.grants")).rows.length, 1);
        assert.equal((await upgrade.query("select * from patreon_roles.audit where action='granted'")).rows.length, 1);
        assert.equal((await upgrade.query<{ due: boolean }>("select due_at<=now() as due from patreon_roles.memberships where member_id=$1", [otherMember])).rows[0].due, true);
        assert.deepEqual((await upgrade.query("select member_id,due_at::text from patreon_roles.memberships order by member_id")).rows, deadlines.rows);
    } finally { await upgrade.close(); }
});

for (const scenario of ["linked event", "unlinked event", "active claim", "abandoned claim", "new link"] as const) {
    test(`upgrade preserves an aged observation's ${scenario} until reconciliation succeeds`, async () => {
        const upgrade = new PGlite();
        try {
            await upgrade.exec(`create role anon; create role authenticated; create role service_role bypassrls;
                create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz,
                    deleted_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb default '{}',updated_at timestamptz default now());`);
            for (const name of ["20260907212654_create_patreon_links", "20260907220000_patreon_website_roles"]) {
                await upgrade.exec(await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8"));
            }
            const call = async (operation: string, input: object = {}) => (await upgrade.query<{ result: unknown }>(
                "select public.patreon_role_sync($1,$2,$3,$4::jsonb) as result", [campaign, tier, operation, JSON.stringify(input)],
            )).rows[0].result;
            const addLink = () => upgrade.query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,$2)", [user, patreonUser]);
            await upgrade.query("insert into auth.users(id,email_confirmed_at,raw_app_meta_data) values($1,now(),'{\"role\":\"User\"}')", [user]);
            if (scenario !== "unlinked event" && scenario !== "new link") await addLink();
            await call("queue", { memberId: member });
            const original = await call("acquire") as Lease;
            await call("complete", { token: original.token, ...original.jobs[0], userId: patreonUser, eligible: true });
            await call("release", { token: original.token });
            // Model twelve minutes elapsing after the successful observation
            // without sleeping, retaining its fifteen-minute periodic deadline.
            await upgrade.exec("update patreon_roles.memberships set observed_at=now()-interval '12 minutes',due_at=now()+interval '3 minutes'");
            if (scenario === "new link") await addLink();
            else await call("queue", { memberId: member });
            let pending: Lease | undefined;
            if (scenario === "active claim" || scenario === "abandoned claim") {
                pending = await call("acquire") as Lease;
                assert.equal(pending.jobs[0].memberId, member);
                if (scenario === "abandoned claim") {
                    // Simulate six more minutes passing after the worker claims
                    // the event and disappears, beyond both lease and retry time.
                    await upgrade.exec(`update patreon_roles.memberships set observed_at=observed_at-interval '6 minutes',due_at=now()-interval '1 minute';
                        update patreon_roles.sync_state set worker_until=now()-interval '4 minutes';`);
                }
            }
            const membershipState = () => upgrade.query(`select member_id,generation,due_at::text,observed_at::text,
                patreon_user_id,website_user_id,eligible,last_error from patreon_roles.memberships`);
            const workerState = () => upgrade.query("select worker_token,worker_until::text,scan_due::text,scan_generation from patreon_roles.sync_state");
            const beforeMember = await membershipState(), beforeWorker = await workerState();
            // Every case matches the removed heuristic, including a previously
            // observed unlinked member and a link created before deployment.
            assert.equal((await upgrade.query<{ aged: boolean }>(
                "select observed_at is not null and due_at>observed_at+interval '10 minutes' as aged from patreon_roles.memberships",
            )).rows[0].aged, true);
            await upgrade.exec(await readFile(new URL("../../migrations/20260908030000_patreon_event_reconciliation.sql", import.meta.url), "utf8"));
            assert.deepEqual((await membershipState()).rows, beforeMember.rows);
            assert.deepEqual((await workerState()).rows, beforeWorker.rows);
            let next: Lease;
            if (scenario === "active claim") {
                assert.equal(await call("acquire"), null);
                next = pending!;
            } else {
                next = await call("acquire") as Lease;
                if (pending) assert.notEqual(next.token, pending.token);
            }
            assert.equal(next.jobs[0].memberId, member);
            assert.deepEqual(await call("complete", {
                token: next.token, ...next.jobs[0], userId: patreonUser, eligible: scenario === "new link",
            }), { applied: true });
            await call("release", { token: next.token });
            const scheduled = (await upgrade.query<{ six_hours: boolean; infinite: boolean }>(`select
                due_at between now()+interval '359 minutes' and now()+interval '361 minutes' as six_hours,
                due_at='infinity'::timestamptz as infinite from patreon_roles.memberships`)).rows[0];
            assert.deepEqual(scheduled, { six_hours: scenario !== "unlinked event", infinite: scenario === "unlinked event" });
            assert.equal((await upgrade.query<{ role: string }>("select raw_app_meta_data->>'role' as role from auth.users")).rows[0].role,
                scenario === "new link" ? "Standard Server" : "User");
        } finally { await upgrade.close(); }
    });
}
