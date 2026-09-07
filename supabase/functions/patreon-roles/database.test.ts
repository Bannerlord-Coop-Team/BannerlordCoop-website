import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { manualRoleMetadata } from "../../../src/app/lib/auth/manual-role";
import { createPatreonRoleHandler } from "../_shared/patreon-roles.ts";
import { createHmac } from "node:crypto";

const campaign = "12345", tier = "28995946";
const member = "11111111-1111-4111-8111-111111111111";
const secondMember = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const secondUser = "44444444-4444-4444-8444-444444444444";
const clear = "truncate patreon_roles.audit, patreon_roles.grants, patreon_roles.memberships, patreon_roles.sync_state, auth.users cascade";
type Job = { memberId: string; generation: number };
let db: PGlite;

before(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users (
            id uuid primary key, email text, email_confirmed_at timestamptz,
            deleted_at timestamptz, banned_until timestamptz,
            raw_app_meta_data jsonb default '{}', updated_at timestamptz default now()
        );`);
    await db.exec(await readFile(new URL("../../migrations/20260907212654_create_patreon_links.sql", import.meta.url), "utf8"));
    // Upgrade the deployed linking schema with a pre-existing link and manual role.
    await addUser(user, "Standard Server");
    await link();
    await db.exec(await readFile(new URL("../../migrations/20260907220000_patreon_website_roles.sql", import.meta.url), "utf8"));
    assert.equal((await metadata()).role, "Standard Server");
    assert.equal((await db.query("select * from public.patreon_accounts")).rows.length, 1);
    assert.equal((await db.query("select * from patreon_roles.grants")).rows.length, 0);
});
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("reset role"); await db.exec(clear); });

async function rpc(operation: string, input: Record<string, unknown> = {}, campaignId = campaign) {
    const result = await db.query<{ result: Record<string, unknown> | null }>(
        "select public.patreon_role_sync($1,$2,$3,$4::jsonb) as result", [campaignId, tier, operation, JSON.stringify(input)],
    );
    return result.rows[0].result;
}
async function addUser(id = user, role: string | null = "User", verified = true) {
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values ($1,$2,$3,$4::jsonb)", [
        id, "different-site-email@example.com", verified ? new Date().toISOString() : null,
        JSON.stringify(role === null ? { unrelated: true } : { role, unrelated: true }),
    ]);
}
async function link(id = user, patreonId = "123") {
    await db.query(`insert into public.patreon_accounts(user_id,patreon_user_id) values ($1,$2)
        on conflict(user_id) do update set patreon_user_id=excluded.patreon_user_id, linked_at=now()`, [id, patreonId]);
}
async function metadata(id = user) {
    return (await db.query<{ metadata: Record<string, unknown> }>("select raw_app_meta_data as metadata from auth.users where id=$1", [id])).rows[0].metadata;
}
async function acquire(): Promise<Record<string, unknown> & { jobs: Job[]; token: string }> {
    const lease = await rpc("acquire");
    assert.ok(lease);
    return { ...lease, jobs: lease.jobs as Job[], token: lease.token as string };
}
async function apply(eligible = true, id = member, userId = "123") {
    await rpc("queue", { memberId: id });
    const lease = await acquire();
    const job = lease.jobs.find((job) => job.memberId === id);
    assert.ok(job);
    const result = await rpc("complete", { token: lease.token, ...job, userId, eligible });
    await rpc("release", { token: lease.token });
    return result;
}
async function eligibleUser() { await addUser(); await link(); await apply(); }

test("only the service role can execute sync or write links; OAuth can still invoke the trigger", async () => {
    await addUser();
    for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        await assert.rejects(() => rpc("queue", { memberId: member }));
        await assert.rejects(() => link());
        await assert.rejects(() => db.query("select * from patreon_roles.memberships"));
        await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.deepEqual(await rpc("queue", { memberId: member }), { queued: true });
    await link();
    await db.exec("reset role");
});

test("verified identity grants independent of email, and repeat grant/revoke is idempotent", async () => {
    await eligibleUser();
    const assigned = await metadata();
    assert.equal(assigned.role, "Standard Server");
    assert.equal(assigned.unrelated, true);
    assert.equal(typeof assigned.patreon_standard_server_grant, "string");
    await apply();
    assert.deepEqual(await metadata(), assigned);
    await apply(false);
    await apply(false);
    assert.deepEqual(await metadata(), { role: "User", unrelated: true });
    assert.deepEqual((await db.query("select action from patreon_roles.audit order by id")).rows,
        [{ action: "granted" }, { action: "revoked" }]);
});

test("matching email or a different linked identity cannot authorize the role", async () => {
    await addUser();
    await apply();
    assert.equal((await metadata()).role, "User");
    await link(user, "999");
    await apply();
    assert.equal((await metadata()).role, "User");
});

test("unconfirmed, banned and deleted website accounts cannot receive grants", async () => {
    await addUser(user, "User", false); await link(); await apply();
    assert.equal((await metadata()).role, "User");
    await db.exec("update auth.users set email_confirmed_at=now(), banned_until=now()+interval '1 day'");
    await apply(); assert.equal((await metadata()).role, "User");
    await db.exec("update auth.users set banned_until=null, deleted_at=now()");
    await apply(); assert.equal((await metadata()).role, "User");
});

test("an unset role is restored without inventing a previous role", async () => {
    await addUser(user, null); await link(); await apply(); await apply(false);
    assert.deepEqual(await metadata(), { unrelated: true });
});

test("a new link schedules fresh verification instead of granting from cached membership", async () => {
    await apply(); await addUser(); await link();
    assert.equal((await metadata()).role, "User");
    const lease = await acquire();
    assert.equal(lease.jobs[0].memberId, member);
    assert.equal(lease.scanDue, true);
    await rpc("complete", { token: lease.token, ...lease.jobs[0], userId: "123", eligible: true });
    assert.equal((await metadata()).role, "Standard Server");
});

test("all manual roles, including Standard Server and unknown roles, are preserved", async () => {
    for (const role of ["Admin", "Premium Server", "Server Manager", "Developer", "Helper", "Standard Server", "Unknown Role"]) {
        await db.exec(clear); await addUser(user, role); await link(); await apply(); await apply(false);
        assert.deepEqual(await metadata(), { role, unrelated: true });
    }
});

test("an administrator saving Standard Server makes it independent from Patreon", async () => {
    await eligibleUser();
    const manual = manualRoleMetadata(await metadata(), "Standard Server");
    await db.query("update auth.users set raw_app_meta_data=$1::jsonb where id=$2", [JSON.stringify(manual), user]);
    await apply(false);
    assert.equal((await metadata()).role, "Standard Server");
    assert.equal((await db.query("select * from patreon_roles.grants")).rows.length, 0);
});

test("new webhook generations and replaced worker leases reject stale results", async () => {
    await addUser(); await link(); await rpc("queue", { memberId: member });
    const lease = await acquire();
    assert.equal(await rpc("acquire"), null);
    await rpc("queue", { memberId: member });
    const input = { token: lease.token, memberId: member, generation: 1, userId: "123", eligible: true };
    assert.deepEqual(await rpc("complete", input), { stale: true });
    await db.exec("update patreon_roles.sync_state set worker_until=now()-interval '1 second'");
    await acquire();
    assert.deepEqual(await rpc("complete", { ...input, generation: 2 }), { stale: true });
    assert.equal((await metadata()).role, "User");
});

test("upstream failure preserves the current grant and leaves a retryable job", async () => {
    await eligibleUser(); const previous = await metadata();
    await rpc("queue", { memberId: member }); const lease = await acquire();
    await rpc("failed", { token: lease.token, ...lease.jobs[0] });
    assert.deepEqual(await metadata(), previous);
    await rpc("release", { token: lease.token });
    await db.exec("update patreon_roles.memberships set due_at=now()");
    assert.equal((await acquire()).jobs.length, 1);
});

test("relinking revokes immediately and fences an in-flight response for the previous identity", async () => {
    await eligibleUser(); await rpc("queue", { memberId: member }); const lease = await acquire();
    await link(user, "456");
    assert.equal((await metadata()).role, "User");
    assert.deepEqual(await rpc("complete", { token: lease.token, ...lease.jobs[0], userId: "123", eligible: true }), { stale: true });
    await rpc("release", { token: lease.token });
    await apply(true, secondMember, "456"); assert.equal((await metadata()).role, "Standard Server");
});

test("deleting a link revokes and cannot transfer a cached entitlement to a new account", async () => {
    await eligibleUser(); await addUser(secondUser);
    await db.query("delete from public.patreon_accounts where user_id=$1", [user]);
    assert.equal((await metadata()).role, "User");
    await link(secondUser); assert.equal((await metadata(secondUser)).role, "User");
    await apply(); assert.equal((await metadata(secondUser)).role, "Standard Server");
});

test("same-identity relinking preserves the grant and direct ownership changes fail", async () => {
    await eligibleUser(); await addUser(secondUser); const previous = await metadata();
    await link(); assert.deepEqual(await metadata(), previous);
    await assert.rejects(() => db.query("update public.patreon_accounts set user_id=$1 where user_id=$2", [secondUser, user]));
    await assert.rejects(() => link(secondUser));
    assert.deepEqual(await metadata(), previous);
});

test("one remaining eligible membership for the linked identity preserves the grant", async () => {
    await eligibleUser(); await apply(true, secondMember); await apply(false);
    assert.equal((await metadata()).role, "Standard Server");
    await apply(false, secondMember); assert.equal((await metadata()).role, "User");
});

test("campaign pins, member identity and discovery bounds fail transactionally", async () => {
    await eligibleUser(); await assert.rejects(() => rpc("queue", { memberId: member }, "999"));
    await rpc("queue", { memberId: member }); const lease = await acquire();
    await assert.rejects(() => rpc("complete", { token: lease.token, ...lease.jobs[0], userId: "999", eligible: false }));
    await assert.rejects(() => rpc("discovered", { token: lease.token, scanGeneration: lease.scanGeneration, memberIds: [secondMember, null], cursor: "" }));
    assert.equal((await db.query("select * from patreon_roles.memberships where member_id=$1", [secondMember])).rows.length, 0);
    assert.equal((await metadata()).role, "Standard Server");
});

test("discovery cursor survives worker replacement without revoking unseen members", async () => {
    await eligibleUser(); const lease = await acquire();
    await rpc("discovered", { token: lease.token, scanGeneration: lease.scanGeneration, memberIds: [secondMember], cursor: "next-page" });
    await rpc("release", { token: lease.token }); const next = await acquire();
    assert.equal(next.cursor, "next-page");
    assert.equal((await metadata()).role, "Standard Server");
    assert.ok(next.jobs.some((job) => job.memberId === secondMember));
});

test("a link during discovery cannot lose its scan request behind a stale last page", async () => {
    const lease = await acquire();
    await addUser(); await link();
    assert.deepEqual(await rpc("discovered", {
        token: lease.token, scanGeneration: lease.scanGeneration, memberIds: [], cursor: "",
    }), { stale: true });
    await rpc("release", { token: lease.token });
    const next = await acquire();
    assert.equal(next.scanDue, true);
    assert.notEqual(next.scanGeneration, lease.scanGeneration);
});

test("signed event through the real worker and SQL RPC grants, retains paid-through access and revokes", async () => {
    await addUser(); await link();
    const webhookSecret = "fixture-webhook-secret", syncSecret = "fixture-scheduler-secret";
    const snapshot = { data: {
        type: "member", id: member,
        attributes: { is_free_trial: false, is_gifted: false, last_charge_status: "Paid", patron_status: "active_patron" },
        relationships: {
            campaign: { data: { type: "campaign", id: campaign } },
            user: { data: { type: "user", id: "123" } },
            currently_entitled_tiers: { data: [{ type: "tier", id: tier }] },
        },
    } };
    const handler = createPatreonRoleHandler({
        campaignId: campaign, tierId: tier, webhookSecret, syncSecret, creatorAccessToken: "fixture-creator-token",
        rpc,
        fetchImplementation: async (input) => new URL(String(input)).pathname.endsWith(`/members/${member}`)
            ? Response.json(snapshot) : Response.json({ data: [], meta: { pagination: { cursors: { next: null } } } }),
    });
    const sync = () => handler(new Request("https://example.test/patreon-roles", {
        method: "POST", headers: { "x-patreon-sync-key": syncSecret },
    }));
    const event = async () => {
        const body = JSON.stringify(snapshot);
        assert.equal((await handler(new Request("https://example.test/patreon-roles", { method: "POST", body, headers: {
            "x-patreon-event": "members:pledge:update",
            "x-patreon-signature": createHmac("md5", webhookSecret).update(body).digest("hex"),
        } }))).status, 202);
    };
    await event(); assert.equal((await metadata()).role, "User");
    assert.equal((await sync()).status, 200); assert.equal((await metadata()).role, "Standard Server");
    snapshot.data.attributes.patron_status = "former_patron";
    await event(); assert.equal((await sync()).status, 200);
    assert.equal((await metadata()).role, "Standard Server");
    snapshot.data.relationships.currently_entitled_tiers.data = [];
    await event(); assert.equal((await sync()).status, 200);
    assert.equal((await metadata()).role, "User");
});
