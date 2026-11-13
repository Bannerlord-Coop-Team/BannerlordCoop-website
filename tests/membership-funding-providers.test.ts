// Embedded PostgreSQL upgrades a populated membership schema to provider-scoped heads
// and hints, then drives the real CP Edge handler against it. No remote credentials.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { createControlPlaneMembershipHandler } from "../supabase/functions/_shared/control-plane-membership";
import { FUNDING_PROVIDERS } from "../supabase/functions/_shared/funding-provider";
import { sha256 } from "../supabase/functions/_shared/membership";

// The generic provider machinery and the Boosty adapter that supplies its identity arm ship together.
const migrations = ["20261112090000_membership_funding_providers.sql", "20261112090100_boosty_membership_adapter.sql"];
const history = ["20260907212654_create_patreon_links.sql", "20260907220000_patreon_website_roles.sql", "20260907230000_atomic_live_console_assignments.sql",
    "202609080002_membership_onboarding.sql", "202609080003_membership_role_locking.sql", "20260908030000_patreon_event_reconciliation.sql",
    "20260910200000_membership_receipt_claims.sql", "202609110001_edge_owned_link_commit.sql", "20260919010000_actionable_patreon_retries.sql",
    "202609220001_patreon_allocation_webhooks.sql", "202609280003_account_owned_membership.sql", "202609280006_membership_paid_access_end.sql",
    "202610020001_membership_allocation_usd20.sql", "20261009170000_patreon_creator_token_refresh.sql"];
const discord = "123456789012345678";
const syncToken = "a".repeat(64);
const memberId = "03ca69c3-ebea-4b9a-8fac-e4a837873254";
const qualifying = { verification: "qualifying", campaignId: "16338430", memberId, tierIds: ["28995946"], verifiedAt: "2026-11-01T12:00:00.000Z", paidThroughAt: null, policyVersion: "patreon-paid-usd20-v1", evidenceSha256: "e".repeat(64) };
const ended = { ...qualifying, verification: "nonqualifying", tierIds: [], paidAccessEndedAt: "2026-11-02T12:00:00.000Z", verifiedAt: "2026-11-02T12:00:00.000Z" };
type Row = Record<string, unknown>;

/** Builds the exact unlinked generation-0 Boosty answer for an account. */
function boostyUnlinked(accountId: string) {
    return { version: 2, provider: "boosty", accountId, discordUserId: null, providerUserId: null, linkGeneration: "0", revision: "0", linkState: "unlinked",
        verification: "unverified", programId: null, memberId: null, tierIds: [], verifiedAt: null, paidThroughAt: null, policyVersion: "boosty-paid-v1", evidenceSha256: null };
}

/** Renames a version 1 Patreon snapshot into the version 2 field names, keeping paidAccessEndedAt presence. */
function asVersion2(v1: Row) {
    const { version, patreonUserId, campaignId, ...shared } = v1;
    assert.equal(version, 1);
    return { ...shared, version: 2, provider: "patreon", providerUserId: patreonUserId, programId: campaignId };
}

test("provider-scoped membership upgrade keeps Patreon exact and answers Boosty unlinked", async t => {
    const db = new PGlite();
    // Positional SQL and RPC helpers over the embedded database.
    const query = (sql: string, args: unknown[] = []) => db.query<Row>(sql, args);
    const rpc = async (name: string, args: unknown[]) => (await query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)).rows[0].result as Row;
    const deleted = new Set<string>();
    let edgeReads = 0;
    // Creates a website account with an initialized Patreon head.
    const fresh = async (discordUserId: string | null = null) => {
        const id = crypto.randomUUID();
        await query("insert into auth.users(id) values($1)", [id]);
        await rpc("membership_fence", [id, discordUserId, false]);
        return id;
    };
    // Links a Patreon identity through the real begin/complete RPCs, then stores fixture evidence.
    const link = async (id: string, patreonUserId: string, evidence: Row) => {
        const hash = await sha256(crypto.randomUUID());
        await rpc("membership_begin", [id, discord, crypto.randomUUID(), hash, "/servers"]);
        await query("update public.patreon_oauth_states set kind='complete',patreon_user_id=$2,evidence=public.membership_empty_evidence() where token_hash=$1", [hash, patreonUserId]);
        await rpc("membership_complete", [id, discord, hash]);
        await query("update public.membership_heads set evidence=$2::jsonb where account_id=$1", [id, JSON.stringify(evidence)]);
    };
    // Acknowledges every pending hint so each scenario observes only its own writes.
    const drain = async () => {
        for (const row of (await query("select event_id from public.membership_outbox where receipt_id is null order by sequence")).rows) {
            await query("update public.membership_outbox set claim_id=null,claim_expires_at=null where event_id=$1", [row.event_id]);
            await rpc("membership_ack", [row.event_id, crypto.randomUUID()]);
        }
    };
    // Serves Auth admin lookups from the fixture and forwards closed RPC names to the embedded database.
    const fetcher: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname; edgeReads++;
        const account = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/u)?.[1];
        if (account) return deleted.has(account) ? new Response("missing", { status: 404 }) : Response.json({ id: account, identities: [{ provider: "discord", identity_data: { sub: discord } }] });
        const name = path.replace("/rest/v1/rpc/", "");
        assert.ok(["membership_fence", "membership_funding_fence", "membership_claim", "membership_funding_claim", "membership_ack_claim"].includes(name), name);
        try { return Response.json(await rpc(name, Object.values(JSON.parse(String(init?.body))))); }
        catch { return Response.json({ message: "refused" }, { status: 400 }); }
    };
    const handler = createControlPlaneMembershipHandler({ supabaseUrl: "https://wfvqnijwuyqjibhlcrhz.supabase.co", serviceRoleKey: "synthetic-service-key", syncToken, fetch: fetcher });
    // Sends one authenticated CP request through the real Edge handler.
    const call = async (body: unknown) => {
        const response = await handler(new Request("https://edge-runtime.supabase.com/control-plane-membership-v1", { method: "POST", headers: { Authorization: `Bearer ${syncToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
        return { status: response.status, body: await response.json() as Row };
    };
    try {
        await db.exec("create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb default '{}', updated_at timestamptz default now()); create role anon; create role authenticated; create role service_role;");
        for (const name of history) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
        // Populated pre-upgrade state: linked with and without confirmed loss, unlinked, deleted, and a live claim.
        const lossOwner = await fresh(), patron = await fresh(), unlinked = await fresh(discord), gone = await fresh();
        await link(lossOwner, "9001", ended);
        await link(patron, "9002", qualifying);
        await query("delete from auth.users where id=$1", [gone]); deleted.add(gone);
        await rpc("membership_ack", [(await query("select event_id from public.membership_outbox order by sequence limit 1")).rows[0].event_id, crypto.randomUUID()]);
        const liveClaim = crypto.randomUUID();
        await rpc("membership_claim", [liveClaim, 2]);
        const accounts = [lossOwner, patron, unlinked, gone];
        const before = new Map<string, Row>();
        for (const id of accounts) before.set(id, await rpc("membership_fence", [id, id === gone ? null : discord, id === gone]));
        const heads = (await query("select * from public.membership_heads order by account_id")).rows;
        const outbox = (await query("select * from public.membership_outbox order by sequence")).rows;
        assert.ok(outbox.some(row => row.claim_id === liveClaim) && outbox.some(row => row.receipt_id !== null) && outbox.some(row => row.receipt_id === null && row.claim_id === null));
        for (const name of migrations) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));

        await t.test("upgrade leaves heads unchanged and labels every existing hint Patreon", async () => {
            assert.deepEqual((await query("select * from public.membership_heads order by account_id")).rows, heads);
            assert.deepEqual((await query("select * from public.membership_outbox order by sequence")).rows, outbox.map(row => ({ ...row, provider: "patreon" })));
            assert.equal((await query("select count(*)::int n from public.membership_provider_heads")).rows[0].n, 0);
            for (const id of accounts) assert.deepEqual(await rpc("membership_fence", [id, id === gone ? null : discord, id === gone]), before.get(id));
            assert.equal((await query("select count(*)::int n from public.membership_outbox")).rows[0].n, outbox.length, "an unchanged fence writes no hint");
        });

        await t.test("Patreon version 2 equals version 1 field for field through the Edge handler", async () => {
            for (const id of accounts) {
                const v1 = await call({ version: 1, operation: "snapshot", accountId: id });
                const v2 = await call({ version: 2, operation: "snapshot", accountId: id, provider: "patreon" });
                assert.equal(v1.status, 200); assert.equal(v2.status, 200);
                assert.deepEqual(v2.body, asVersion2(v1.body));
                assert.deepEqual(asVersion2(before.get(id)!), v2.body);
            }
            assert.equal((await call({ version: 2, operation: "snapshot", accountId: lossOwner, provider: "patreon" })).body.paidAccessEndedAt, ended.paidAccessEndedAt);
        });

        await t.test("Boosty answers a constant unlinked generation-0 head for live accounts without writing", async () => {
            for (const id of [lossOwner, patron, unlinked]) assert.deepEqual((await call({ version: 2, operation: "snapshot", accountId: id, provider: "boosty" })).body, boostyUnlinked(id));
            assert.equal((await query("select count(*)::int n from public.membership_provider_heads")).rows[0].n, 0);
            assert.equal((await query("select count(*)::int n from public.membership_outbox")).rows[0].n, outbox.length);
            await assert.rejects(rpc("membership_funding_fence", [patron, "ko-fi", null, false]), /Invalid funding provider/u);
        });

        await t.test("Boosty deletion is a durable tombstone with its own hint and cannot be resurrected", async () => {
            await drain();
            const first = await call({ version: 2, operation: "snapshot", accountId: gone, provider: "boosty" });
            assert.deepEqual(first.body, { ...boostyUnlinked(gone), linkGeneration: "1", revision: "1", linkState: "account_deleted" });
            assert.deepEqual((await query("select provider,revision::text from public.membership_outbox where account_id=$1 and receipt_id is null", [gone])).rows, [{ provider: "boosty", revision: "1" }]);
            await assert.rejects(rpc("membership_funding_fence", [gone, "boosty", null, false]), /cannot be resurrected/u);
        });

        await t.test("Auth deletion tombstones Patreon and every existing provider head", async () => {
            await drain();
            const id = await fresh();
            await query("insert into public.membership_provider_heads(account_id,provider,discord_user_id,provider_user_id,link_generation,revision,link_state,evidence) values($1,'boosty',$2,'77',4,7,'linked',public.membership_provider_empty_evidence('boosty'))", [id, discord]);
            await query("delete from auth.users where id=$1", [id]);
            assert.deepEqual((await query("select link_state,provider_user_id from public.membership_provider_heads where account_id=$1", [id])).rows, [{ link_state: "account_deleted", provider_user_id: null }]);
            assert.deepEqual((await query("select provider,revision::text from public.membership_outbox where account_id=$1 and receipt_id is null order by sequence", [id])).rows,
                [{ provider: "patreon", revision: "1" }, { provider: "boosty", revision: "8" }]);
        });

        await t.test("claim version 3 leases exactly the version 2 rows, names providers and accepts version 2 acks", async () => {
            const v2Claim = crypto.randomUUID(), v3Claim = crypto.randomUUID();
            const v2 = (await call({ version: 2, operation: "claim", claimId: v2Claim, limit: 50 })).body;
            assert.equal(v2.version, 2);
            const events = v2.events as Row[];
            assert.ok(events.length >= 2 && events.every(event => !Object.hasOwn(event, "provider")));
            assert.deepEqual((await call({ version: 3, operation: "claim", claimId: v3Claim, limit: 50 })).body.events, [], "a live lease is exclusive across versions");
            await query("update public.membership_outbox set claim_expires_at=clock_timestamp()-interval '1 second' where claim_id=$1", [v2Claim]);
            const v3 = await call({ version: 3, operation: "claim", claimId: v3Claim, limit: 50 });
            assert.equal(v3.status, 200); assert.equal(v3.body.version, 3); assert.equal(v3.body.claimId, v3Claim);
            const named = v3.body.events as Row[];
            assert.deepEqual(named.map(event => ({ eventId: event.eventId, accountId: event.accountId })), events);
            assert.ok(named.some(event => event.provider === "boosty") && named.some(event => event.provider === "patreon"));
            assert.deepEqual((await call({ version: 3, operation: "claim", claimId: v3Claim, limit: 50 })).body, v3.body, "a lost claim response replays the same page");
            const boosty = named.find(event => event.provider === "boosty")!;
            const receiptId = crypto.randomUUID();
            assert.deepEqual((await call({ version: 2, operation: "ack", eventId: boosty.eventId, receiptId, claimId: v3Claim })).body, { version: 2, acknowledged: true, eventId: boosty.eventId, receiptId, claimId: v3Claim });
        });

        await t.test("provider hint bounds are independent and acknowledgements repair their own provider", async () => {
            await drain();
            const id = await fresh();
            await query("insert into public.membership_provider_heads(account_id,provider,revision,evidence) values($1,'boosty',0,public.membership_provider_empty_evidence('boosty'))", [id]);
            await query("insert into public.membership_outbox(account_id,provider,revision) select $1,'boosty',g from generate_series(1,9) g", [id]);
            await query("update public.membership_provider_heads set revision=10 where account_id=$1", [id]);
            // A full Boosty queue does not count against an ordinary Patreon notification.
            await rpc("membership_fence", [id, discord, false]);
            assert.equal((await query("select count(*)::int n from public.membership_outbox where account_id=$1 and provider='patreon' and receipt_id is null", [id])).rows[0].n, 1);
            // The full Boosty queue defers revision 10 until an acknowledgement repairs it.
            await rpc("membership_ack", [(await query("select event_id from public.membership_outbox where account_id=$1 and provider='boosty' order by sequence limit 1", [id])).rows[0].event_id, crypto.randomUUID()]);
            assert.deepEqual((await query("select provider,revision::text from public.membership_outbox where account_id=$1 and receipt_id is null order by sequence desc limit 1", [id])).rows, [{ provider: "boosty", revision: "10" }]);
        });

        await t.test("the generic fence follows the adapter's identity lookup with Patreon's identity, Discord and tombstone rules", async () => {
            await drain();
            const id = await fresh();
            const fence = async (discordUserId: string | null, deletedAccount = false) => await rpc("membership_funding_fence", [id, "boosty", discordUserId, deletedAccount]);
            const head = async () => (await query("select provider_user_id,link_state,link_generation::text g,revision::text r from public.membership_provider_heads where account_id=$1", [id])).rows[0];
            const hints = async () => (await query("select revision::text from public.membership_outbox where account_id=$1 and provider='boosty' and receipt_id is null order by sequence", [id])).rows.map(row => row.revision);
            await query("insert into boosty_membership.links(account_id,boosty_user_id) values($1,'4242')", [id]);
            // A binding the head has not seen yet is an identity change: a new generation, empty evidence and a hint.
            assert.deepEqual(await fence(discord), { ...boostyUnlinked(id), discordUserId: discord, providerUserId: "4242", linkGeneration: "1", revision: "1", linkState: "identity_changed" });
            // Optional Discord metadata only bumps the revision and keeps the generation and evidence.
            await query("update public.membership_provider_heads set evidence=evidence || '{\"verification\":\"qualifying\"}'::jsonb where account_id=$1", [id]);
            const relabeled = await fence("999456789012345678");
            assert.deepEqual([relabeled.linkGeneration, relabeled.revision, relabeled.verification], ["1", "2", "qualifying"]);
            await query("delete from boosty_membership.links where account_id=$1", [id]);
            assert.deepEqual([(await fence(discord)).linkState, (await head()).g], ["unlinked", "2"]);
            assert.deepEqual(await hints(), ["1", "2", "3"], "every head change emits one hint for its own revision");
        });

        await t.test("strict version 2 and 3 requests reject wrong keys, providers and versions without SQL", async () => {
            const accountId = patron, claimId = crypto.randomUUID(); edgeReads = 0;
            for (const bad of [
                { version: 2, operation: "snapshot", accountId }, { version: 2, operation: "snapshot", accountId, provider: "patreon", extra: 1 },
                { version: 2, operation: "snapshot", accountId, provider: "Patreon" }, { version: 2, operation: "snapshot", accountId, provider: null },
                { version: 1, operation: "snapshot", accountId, provider: "patreon" }, { version: 3, operation: "snapshot", accountId, provider: "boosty" },
                { version: 2, operation: "snapshot", accountId: accountId.toUpperCase(), provider: "boosty" },
                { version: 3, operation: "claim", claimId, limit: 51 }, { version: 3, operation: "claim", claimId }, { version: 3, operation: "claim", claimId, limit: 1, provider: "boosty" },
                { version: 4, operation: "claim", claimId, limit: 1 }, { version: 3, operation: "ack", eventId: claimId, receiptId: claimId, claimId },
            ]) assert.equal((await call(bad)).status, 400, JSON.stringify(bad));
            assert.equal(edgeReads, 0);
        });
    } finally { await db.close(); }
});

// Real multi-session PostgreSQL (fixture-only URL, fresh database): PGlite cannot hold two sessions.
const url = process.env.WEBSITE_FUNDING_TEST_URL;
test("provider fences share the account lock and version 3 claims keep SKIP LOCKED leases across sessions", { skip: !url }, async t => {
    const target = new URL(url!);
    assert.ok(["127.0.0.1", "localhost"].includes(target.hostname) && target.pathname === "/website_funding_test", "Only the owned local fixture database is allowed");
    const [owner, peer] = [new pg.Client({ connectionString: url }), new pg.Client({ connectionString: url })];
    await owner.connect(); await peer.connect();
    const rpc = async (client: pg.Client, name: string, args: unknown[]) => (await client.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)).rows[0].result as Row;
    try {
        await owner.query("create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb default '{}', updated_at timestamptz default now()); create role anon; create role authenticated; create role service_role;");
        for (const name of [...history, ...migrations]) await owner.query(await readFile(`supabase/migrations/${name}`, "utf8"));
        const id = crypto.randomUUID(), other = crypto.randomUUID();
        await owner.query("insert into auth.users(id) values($1),($2)", [id, other]);
        await t.test("a held account lock refuses the Boosty tombstone instead of waiting, then it commits once", async () => {
            await owner.query("begin");
            await rpc(owner, "membership_fence", [id, discord, false]);
            await assert.rejects(rpc(peer, "membership_funding_fence", [id, "boosty", null, true]), { code: "55P03" });
            assert.deepEqual(await rpc(peer, "membership_funding_fence", [other, "boosty", null, false]), boostyUnlinked(other), "other accounts progress");
            await owner.query("commit");
            assert.equal((await rpc(peer, "membership_funding_fence", [id, "boosty", null, true])).linkState, "account_deleted");
        });
        await t.test("concurrent version 3 claims skip rows another session is leasing", async () => {
            await rpc(owner, "membership_funding_fence", [other, "boosty", null, true]);
            const pending = Number((await owner.query("select count(*) n from public.membership_outbox where receipt_id is null")).rows[0].n);
            assert.ok(pending >= 2);
            await owner.query("begin");
            const first = await rpc(owner, "membership_funding_claim", [crypto.randomUUID(), 1]);
            const second = await rpc(peer, "membership_funding_claim", [crypto.randomUUID(), 50]);
            await owner.query("commit");
            const firstEvents = first.events as Row[], secondEvents = second.events as Row[];
            assert.equal(firstEvents.length, 1); assert.equal(secondEvents.length, pending - 1);
            assert.ok(!secondEvents.some(event => event.eventId === firstEvents[0].eventId));
            assert.ok([...firstEvents, ...secondEvents].every(event => (FUNDING_PROVIDERS as readonly unknown[]).includes(event.provider)));
        });
        const sync = async (client: pg.Client, operation: string, input: Row) => (await client.query("select public.boosty_membership_sync($1,$2::jsonb) result", [operation, JSON.stringify(input)])).rows[0].result as Row | null;
        await t.test("concurrent Boosty workers get exactly one lease", async () => {
            for (let round = 0; round < 10; round++) {
                const leases = await Promise.all([sync(owner, "acquire", { blog: "coop-team" }), sync(peer, "acquire", { blog: "coop-team" })]);
                for (const lease of leases) if (lease !== null) await sync(owner, "release", { token: lease.token });
                assert.equal(leases.filter(lease => lease !== null).length, 1, `round ${round}`);
            }
        });
        await t.test("an email match for a locked account is skipped without waiting, then links once", async () => {
            const account = crypto.randomUUID();
            await owner.query("insert into auth.users(id,email) values($1,'locked@example.invalid')", [account]);
            const lease = await sync(peer, "acquire", { blog: "coop-team" });
            const match = () => sync(peer, "match", { token: lease!.token, subscribers: [{ boostyUserId: "7070", emailSha256: createHash("sha256").update("locked@example.invalid").digest("hex") }] });
            await owner.query("begin");
            await rpc(owner, "membership_fence", [account, null, false]);
            assert.deepEqual(await match(), { linked: 0, released: 0 });
            await owner.query("commit");
            assert.deepEqual(await match(), { linked: 1, released: 0 });
            await sync(peer, "release", { token: lease!.token });
            assert.equal((await rpc(owner, "membership_funding_fence", [account, "boosty", null, false])).providerUserId, "7070");
        });
    } finally { await owner.end(); await peer.end(); }
});
