// Embedded PostgreSQL runs the real Boosty adapter migration on a populated membership schema,
// then drives the real worker, website-account and CP handlers against it. No Boosty contact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createControlPlaneMembershipHandler } from "../supabase/functions/_shared/control-plane-membership";
import { parseFundingSnapshot } from "../supabase/functions/_shared/funding-provider";
import { createBoostyMembershipHandler, type BoostyAdapter } from "../supabase/functions/_shared/boosty-membership";
import { createWebsiteAccountHandler } from "../supabase/functions/_shared/website-account";
import { parseBoostyStatus } from "../supabase/functions/_shared/boosty-account";
import type { BoostyApi, BoostySubscriber } from "../supabase/functions/_shared/boosty-api";
import type { BoostyCredential } from "../supabase/functions/_shared/boosty-credential";
import type { BoostyPolicy } from "../supabase/functions/_shared/boosty-policy";

const history = ["20260907212654_create_patreon_links.sql", "20260907220000_patreon_website_roles.sql", "20260907230000_atomic_live_console_assignments.sql",
    "202609080002_membership_onboarding.sql", "202609080003_membership_role_locking.sql", "20260908030000_patreon_event_reconciliation.sql",
    "20260910200000_membership_receipt_claims.sql", "202609110001_edge_owned_link_commit.sql", "20260919010000_actionable_patreon_retries.sql",
    "202609220001_patreon_allocation_webhooks.sql", "202609280003_account_owned_membership.sql", "202609280006_membership_paid_access_end.sql",
    "202610020001_membership_allocation_usd20.sql", "20261009170000_patreon_creator_token_refresh.sql", "20261109140000_membership_funding_providers.sql"];
const migration = "20261110120000_boosty_membership_adapter.sql";
const policy: BoostyPolicy = { blog: "coop-team", qualifyingLevelIds: ["555"], minimumPrice: 500, priceField: "RUB", maximumDropFraction: 0.25, policyVersion: "boosty-paid-v1" };
const syncToken = "a".repeat(64), syncSecret = "boosty-sync-secret-fixture";
const vault = `create schema vault;
    create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
    create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
    returns uuid language sql as $$ insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id; $$;
    create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
    returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id; $$;`;
type Row = Record<string, unknown>;

/** Hashes an email the way the worker does: trimmed and lower-cased. */
const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** Builds a qualifying listed subscriber for the fixture policy. */
function subscriber(id: string, email: string, overrides: Partial<BoostySubscriber> = {}): BoostySubscriber {
    return { id, emailSha256: emailHash(email), subscribed: true, status: "active", offTime: null, blacklisted: false, levelId: "555", price: 500, ...overrides };
}

test("Boosty adapter links by email, decides evidence conservatively and serves CP v2 snapshots", async t => {
    const db = new PGlite();
    // Positional SQL and RPC helpers over the embedded database.
    const query = (sql: string, args: unknown[] = []) => db.query<Row>(sql, args);
    const rpc = async (name: string, args: unknown[]) => (await query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)).rows[0].result as Row;
    const sync = async (operation: string, input: Row) => (await query("select public.boosty_membership_sync($1,$2::jsonb) result", [operation, JSON.stringify(input)])).rows[0].result as Row | null;
    // Creates a website account with an initialized Patreon head and the given Auth email.
    const fresh = async (email: string | null = null) => { const id = crypto.randomUUID(); await query("insert into auth.users(id,email) values($1,$2)", [id, email]); await rpc("membership_fence", [id, null, false]); return id; };
    // Runs one leased worker operation sequence and always releases the lease.
    const leased = async <T>(work: (token: string) => Promise<T>) => {
        const lease = await sync("acquire", { blog: policy.blog });
        assert.ok(lease && typeof lease.token === "string");
        try { return await work(lease.token as string); } finally { await sync("release", { token: lease.token }); }
    };
    // Sends listed subscribers (Boosty user id, email) to the worker's match operation.
    const match = (listed: [string, string][]) => leased(token => sync("match", { token, subscribers: listed.map(([boostyUserId, email]) => ({ boostyUserId, emailSha256: emailHash(email) })) }));
    // Links one account to one Boosty user through an email match.
    const linkThrough = async (account: string, boostyUserId: string) => {
        const email = `${boostyUserId}@example.invalid`;
        await query("update auth.users set email=$2 where id=$1", [account, email]);
        assert.deepEqual(await match([[boostyUserId, email]]), { linked: 1, released: 0 });
    };
    // Reads the account's Boosty head, or undefined when none was written.
    const head = async (account: string) => (await query("select link_state, link_generation::text, revision::text, provider_user_id, evidence->>'verification' verification from public.membership_provider_heads where account_id=$1 and provider='boosty'", [account])).rows[0];
    const deleted = new Set<string>();
    // Serves Auth admin lookups from the fixture and forwards closed RPC names to the embedded database.
    const edgeFetch: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        const account = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/u)?.[1];
        if (account) return deleted.has(account) ? new Response("missing", { status: 404 }) : Response.json({ id: account, identities: [] });
        if (path === "/auth/v1/user") return Response.json({ id: viewer, identities: [] });
        if (path === "/rest/v1/rpc/website_session_context") return Response.json({ impersonationId: null });
        const name = path.replace("/rest/v1/rpc/", "");
        assert.equal(name, "membership_funding_fence");
        try { return Response.json(await rpc(name, Object.values(JSON.parse(String(init?.body))))); }
        catch (error) { return Response.json({ code: (error as { code?: string }).code ?? "XX000", message: "refused" }, { status: (error as { code?: string }).code === "PT429" ? 429 : 400 }); }
    };
    let viewer = "";
    const cp = createControlPlaneMembershipHandler({ supabaseUrl: "https://wfvqnijwuyqjibhlcrhz.supabase.co", serviceRoleKey: "synthetic-service-key", syncToken, fetch: edgeFetch });
    // Requests one CP version 2 Boosty snapshot through the real Edge handler.
    const cpSnapshot = async (accountId: string) => {
        const response = await cp(new Request("https://edge-runtime.supabase.com/control-plane-membership-v1", { method: "POST", headers: { Authorization: `Bearer ${syncToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: 2, operation: "snapshot", accountId, provider: "boosty" }) }));
        assert.equal(response.status, 200);
        return parseFundingSnapshot(await response.json(), accountId, "boosty");
    };
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb default '{}', updated_at timestamptz default now()); ${vault}`);
        for (const name of history) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
        // Populated pre-upgrade state: a tombstoned Boosty head and Patreon heads.
        const tombstoned = await fresh(), live = await fresh();
        await rpc("membership_funding_fence", [tombstoned, "boosty", null, true]);
        // Before an adapter is installed the provider migration's identity stub refuses every live fence.
        await assert.rejects(rpc("membership_funding_fence", [live, "boosty", null, false]), /Invalid funding provider/u);
        const before = (await query("select * from public.membership_provider_heads order by account_id")).rows;
        const outbox = (await query("select * from public.membership_outbox order by sequence")).rows;
        await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));

        await t.test("upgrade keeps provider heads and hints; unlinked accounts still answer the constant head", async () => {
            assert.deepEqual((await query("select * from public.membership_provider_heads order by account_id")).rows, before);
            assert.deepEqual((await query("select * from public.membership_outbox order by sequence")).rows, outbox);
            const snapshot = await rpc("membership_funding_fence", [live, "boosty", null, false]);
            assert.deepEqual([snapshot.linkState, snapshot.linkGeneration, snapshot.revision, snapshot.providerUserId], ["unlinked", "0", "0", null]);
            assert.equal((await rpc("membership_funding_fence", [tombstoned, "boosty", null, true])).linkState, "account_deleted");
        });

        await t.test("an email match links case- and whitespace-insensitively, bumps generation and emits a Boosty hint", async () => {
            const id = await fresh("Fan@Example.INVALID");
            assert.deepEqual(await match([["4242", "  fan@example.invalid "]]), { linked: 1, released: 0 });
            assert.deepEqual(await head(id), { link_state: "linked", link_generation: "1", revision: "1", provider_user_id: "4242", verification: "unknown" });
            assert.deepEqual((await query("select provider, revision::text from public.membership_outbox where account_id=$1 and receipt_id is null", [id])).rows, [{ provider: "boosty", revision: "1" }]);
            const snapshot = await cpSnapshot(id);
            assert.equal(snapshot.linkState, "linked"); assert.equal(snapshot.providerUserId, "4242"); assert.equal(snapshot.verification, "unknown");
            assert.deepEqual(await match([["4242", "fan@example.invalid"]]), { linked: 0, released: 0 }, "a repeated match is a no-op");
            const stranger = await fresh("stranger@example.invalid");
            assert.deepEqual(await match([["4343", "nobody@example.invalid"]]), { linked: 0, released: 0 });
            assert.equal(await head(stranger), undefined, "no match leaves the account unlinked");
            await assert.rejects(match([["0", "x@example.invalid"]]), /invalid_boosty_subscribers/u);
        });

        await t.test("an email shared by two accounts links neither, and a linked Boosty user is not moved", async () => {
            const first = await fresh("twin@example.invalid"), second = await fresh("TWIN@example.invalid");
            assert.deepEqual(await match([["7070", "twin@example.invalid"]]), { linked: 0, released: 0 });
            assert.deepEqual([await head(first), await head(second)], [undefined, undefined]);
            const owner = await fresh("owner@example.invalid");
            assert.deepEqual(await match([["7777", "owner@example.invalid"]]), { linked: 1, released: 0 });
            const copycat = await fresh("owner@example.invalid");
            assert.deepEqual(await match([["7777", "owner@example.invalid"]]), { linked: 0, released: 0 }, "a second account with the same email changes nothing");
            assert.equal((await query("select account_id from boosty_membership.links where boosty_user_id='7777'")).rows[0].account_id, owner);
            assert.equal(await head(copycat), undefined);
            assert.deepEqual(await match([["7878", "owner@example.invalid"]]), { linked: 0, released: 0 }, "the email now belongs to two accounts");
            assert.deepEqual(await match([]), { linked: 0, released: 0 }, "an unlisted subscriber keeps its link");
            assert.equal((await head(owner)).link_state, "linked");
        });

        await t.test("an email change releases the link through the unlink fence, then the new owner of the email links", async () => {
            const before = await fresh("mover@example.invalid");
            await match([["6060", "mover@example.invalid"]]);
            await query("update auth.users set email='moved@example.invalid' where id=$1", [before]);
            const next = await fresh("mover@example.invalid");
            assert.deepEqual(await match([["6060", "mover@example.invalid"]]), { linked: 1, released: 1 });
            assert.deepEqual(await head(before), { link_state: "unlinked", link_generation: "2", revision: "2", provider_user_id: null, verification: "unverified" });
            assert.deepEqual((await query("select revision::text from public.membership_outbox where account_id=$1 and provider='boosty' and receipt_id is null order by sequence", [before])).rows.map(row => row.revision), ["1", "2"]);
            assert.deepEqual([(await head(next)).link_state, (await head(next)).provider_user_id], ["linked", "6060"]);
            await query("update auth.users set email='elsewhere@example.invalid' where id=$1", [next]);
            assert.deepEqual(await match([["6060", "Mover@example.invalid"]]), { linked: 0, released: 1 }, "an email change on either side releases");
            assert.equal((await cpSnapshot(next)).linkState, "unlinked");
        });

        await t.test("evidence writes are validated, fenced by link generation and satisfy the CP Boosty grammar", async () => {
            const id = await fresh();
            await linkThrough(id, "3131");
            const verifiedAt = new Date().toISOString();
            const evidence = { verification: "qualifying", programId: "coop-team", memberId: null, tierIds: ["555"], verifiedAt, paidThroughAt: null, policyVersion: "boosty-paid-v1", evidenceSha256: "b".repeat(64) };
            const write = (results: Row[]) => leased(token => sync("evidence", { token, results }));
            assert.deepEqual(await write([{ accountId: id, providerUserId: "3131", linkGeneration: 1, evidence, absentSince: null }]), { written: 1 });
            assert.equal((await cpSnapshot(id)).verification, "qualifying");
            assert.deepEqual(await write([{ accountId: id, providerUserId: "3131", linkGeneration: 0, evidence, absentSince: null }]), { written: 0 }, "a stale link generation is skipped");
            const earlier = new Date(Date.parse(verifiedAt) - 86_400_000).toISOString(), later = new Date(Date.parse(verifiedAt) + 86_400_000).toISOString();
            const loss = { ...evidence, verification: "nonqualifying", tierIds: [], paidAccessEndedAt: earlier };
            for (const bad of [{ ...evidence, programId: "other" }, { ...evidence, tierIds: [] }, { ...loss, paidAccessEndedAt: later }, { ...loss, paidThroughAt: later },
                { ...evidence, paidThroughAt: earlier }, { ...evidence, verification: "nonqualifying", paidThroughAt: later }, { ...evidence, extra: 1 }]) {
                await assert.rejects(write([{ accountId: id, providerUserId: "3131", linkGeneration: 1, evidence: bad, absentSince: null }]), /invalid_boosty_result/u, JSON.stringify(bad));
            }
            assert.deepEqual(await write([{ accountId: id, providerUserId: "3131", linkGeneration: 1, evidence: { ...evidence, paidThroughAt: later }, absentSince: null }]), { written: 1 });
            assert.equal((await cpSnapshot(id)).paidThroughAt, later);
            await write([{ accountId: id, providerUserId: "3131", linkGeneration: 1, evidence: loss, absentSince: verifiedAt }]);
            const lost = await cpSnapshot(id);
            assert.equal(lost.paidAccessEndedAt, earlier); assert.deepEqual(lost.tierIds, []);
            assert.equal((await query("select absent_since is not null recorded from boosty_membership.absences where account_id=$1", [id])).rows[0].recorded, true);
        });

        await t.test("a failed poll marks only evidence older than 24 hours unknown and never writes loss", async () => {
            const fresher = await fresh(), staler = await fresh();
            await linkThrough(fresher, "6101"); await linkThrough(staler, "6102");
            const recent = new Date().toISOString(), old = new Date(Date.now() - 25 * 3_600_000).toISOString();
            const base = { verification: "qualifying", programId: "coop-team", memberId: null, tierIds: ["555"], paidThroughAt: null, policyVersion: "boosty-paid-v1", evidenceSha256: "c".repeat(64) };
            await leased(token => sync("evidence", { token, results: [
                { accountId: fresher, providerUserId: "6101", linkGeneration: 1, evidence: { ...base, verifiedAt: recent }, absentSince: null },
                { accountId: staler, providerUserId: "6102", linkGeneration: 1, evidence: { ...base, verifiedAt: old }, absentSince: null }] }));
            await leased(token => sync("stale", { token }));
            assert.equal((await cpSnapshot(fresher)).verification, "qualifying");
            const stale = await cpSnapshot(staler);
            assert.equal(stale.verification, "unknown"); assert.equal(stale.paidAccessEndedAt, undefined); assert.equal(stale.programId, "coop-team");
        });

        await t.test("only a complete untripped poll moves the breaker baseline; trips alert at most every 6 hours", async () => {
            await leased(token => sync("polled", { token, complete: true, tripped: false, total: 40 }));
            assert.equal((await query("select last_complete_count from boosty_membership.sync_state")).rows[0].last_complete_count, 40);
            assert.deepEqual(await leased(token => sync("polled", { token, complete: false, tripped: true, total: null })), { alert: true });
            assert.deepEqual(await leased(token => sync("polled", { token, complete: false, tripped: true, total: null })), { alert: false });
            assert.equal((await query("select last_complete_count from boosty_membership.sync_state")).rows[0].last_complete_count, 40, "a trip holds the baseline");
            await query("update boosty_membership.sync_state set last_complete_count=null, next_poll_at='-infinity'");
        });

        await t.test("Auth deletion releases the binding and tombstones the head", async () => {
            const id = await fresh();
            await linkThrough(id, "5151");
            await query("delete from auth.users where id=$1", [id]); deleted.add(id);
            assert.equal((await query("select count(*)::int n from boosty_membership.links where boosty_user_id='5151'")).rows[0].n, 0);
            assert.equal((await cpSnapshot(id)).linkState, "account_deleted");
        });

        await t.test("the credential store seeds, rotates both secrets under its generation fence and rate-limits alerts", async () => {
            const credential = async (operation: string, input: Row) => (await query("select public.boosty_creator_credential($1,$2::jsonb) result", [operation, JSON.stringify(input)])).rows[0].result as Row;
            assert.deepEqual(await credential("read", {}), { configured: false, generation: 0 });
            assert.deepEqual(await credential("seed", { deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1" }), { seeded: true, generation: 1 });
            assert.deepEqual(await credential("rotate", { generation: 1, accessToken: "access-token-fixture-2", refreshToken: "refresh-token-fixture-2", expiresIn: 86400 }), { rotated: true, generation: 2 });
            assert.deepEqual(await credential("rotate", { generation: 1, accessToken: "access-token-fixture-3", refreshToken: "refresh-token-fixture-3", expiresIn: 86400 }), { stale: true, generation: 2 });
            const read = await credential("read", {});
            assert.deepEqual([read.accessToken, read.refreshToken, read.refreshDue], ["access-token-fixture-2", "refresh-token-fixture-2", false]);
            assert.deepEqual(await credential("failed", { generation: 2, reason: "rejected" }), { recorded: true, alert: true });
            assert.deepEqual(await credential("failed", { generation: 2, reason: "unavailable" }), { recorded: true, alert: false });
        });

        await t.test("the worker links by email, polls a complete list and the CP sees qualifying evidence", async () => {
            const id = await fresh("Supporter@Example.invalid"); viewer = id;
            const shared = await fresh("dup@example.invalid");
            const account = createWebsiteAccountHandler({ supabaseUrl: "https://wfvqnijwuyqjibhlcrhz.supabase.co", serviceRoleKey: "synthetic-service-key", policy: null, boosty: policy, fetch: edgeFetch });
            // Reads the fixture viewer's public Boosty status through the real website-account handler.
            const status = async () => {
                const response = await account(new Request("https://edge-runtime.supabase.com/website-account", { method: "POST", headers: { Authorization: "Bearer synthetic-user-jwt", "Content-Type": "application/json" }, body: JSON.stringify({ operation: "boosty-status" }) }));
                return parseBoostyStatus(await response.json());
            };
            assert.deepEqual(await status(), { version: 1, configured: true, linked: false, verification: "unverified" });
            // Two subscribers sharing one email are ambiguous: neither links.
            const subscribers = new Map<string, BoostySubscriber>([["8888", subscriber("8888", "supporter@example.invalid")],
                ["9991", subscriber("9991", "dup@example.invalid")], ["9992", subscriber("9992", "dup@example.invalid")]]);
            const calls: string[] = [];
            const api: BoostyApi = { subscribers: async offset => { calls.push(`subscribers:${offset}`); return { subscribers: [...subscribers.values()], total: subscribers.size }; } };
            const credential: BoostyCredential = { current: async () => "access", replace: async () => null, reportFailure: async () => undefined };
            const adapter: BoostyAdapter = { policy, credential, api };
            const alerts: string[] = [];
            const worker = createBoostyMembershipHandler({ adapter, syncSecret, rpc: sync, alert: async kind => { alerts.push(kind); } });
            const wake = () => worker(new Request("https://edge-runtime.supabase.com/boosty-membership", { method: "POST", headers: { "x-boosty-sync-key": syncSecret } }));
            assert.equal((await wake()).status, 200);
            assert.deepEqual(calls, ["subscribers:0"]);
            assert.deepEqual(await status(), { version: 1, configured: true, linked: true, verification: "qualifying" }, "linked and decided in the same poll");
            const snapshot = await cpSnapshot(id);
            assert.deepEqual([snapshot.providerUserId, snapshot.verification, snapshot.tierIds, snapshot.programId], ["8888", "qualifying", ["555"], "coop-team"]);
            assert.equal(await head(shared), undefined);
            // Not due again: the next wake reads nothing from Boosty.
            calls.length = 0; assert.equal((await wake()).status, 200); assert.deepEqual(calls, []);
            // A lapsed subscriber stays listed as inactive; its past offTime is the confirmed loss.
            await query("update boosty_membership.sync_state set next_poll_at='-infinity'");
            const offTime = new Date(Date.now() - 3_600_000).toISOString();
            subscribers.set("8888", subscriber("8888", "supporter@example.invalid", { subscribed: false, status: "inactive", offTime }));
            assert.equal((await wake()).status, 200);
            const lapsed = await cpSnapshot(id);
            assert.deepEqual([lapsed.verification, lapsed.tierIds, lapsed.paidAccessEndedAt], ["nonqualifying", [], offTime]);
            assert.deepEqual(alerts, []);
        });

        await t.test("the cron dispatcher posts one authenticated wakeup only when enabled and configured", async () => {
            await db.exec(`create schema net; create table net.requests(id bigserial primary key, url text, headers jsonb, body jsonb, timeout integer);
                create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
                returns bigint language sql as $$ insert into net.requests(url, headers, body, timeout) values (url, headers, body, timeout_milliseconds) returning id; $$;`);
            const dispatch = async () => (await query("select boosty_membership.dispatch() id")).rows[0].id;
            assert.equal(await dispatch(), null, "disabled by default");
            await query("update boosty_membership.sync_state set dispatch_enabled=true, dispatch_until=null");
            await query("select vault.create_secret('https://attacker.invalid/functions/v1/boosty-membership','boosty_membership_function_url')");
            await query("select vault.create_secret($1,'boosty_membership_sync_secret')", [syncSecret]);
            assert.equal(await dispatch(), null, "only the canonical project URL is accepted");
            await query("update vault.secrets set secret='https://abcdefghijklmnopqrst.supabase.co/functions/v1/boosty-membership' where name='boosty_membership_function_url'");
            assert.ok(Number(await dispatch()) > 0);
            assert.deepEqual((await query("select url, headers, body, timeout from net.requests")).rows, [{ url: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/boosty-membership",
                headers: { "Content-Type": "application/json", "X-Boosty-Sync-Key": syncSecret }, body: {}, timeout: 60000 }]);
            assert.equal(await dispatch(), null, "a recent dispatch coalesces");
        });

        await t.test("client roles cannot execute the private membership functions", async () => {
            for (const role of ["anon", "authenticated"]) {
                for (const fn of ["membership_funding_fence(uuid,text,text,boolean)", "membership_funding_claim(uuid,integer)", "boosty_membership_sync(text,jsonb)", "boosty_creator_credential(text,jsonb)"]) {
                    assert.equal((await query("select has_function_privilege($1,$2,'execute') allowed", [role, `public.${fn}`])).rows[0].allowed, false, `${role} ${fn}`);
                }
            }
        });
    } finally { await db.close(); }
});
