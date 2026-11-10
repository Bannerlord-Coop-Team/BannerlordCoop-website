// Embedded PostgreSQL runs the real Boosty adapter migration on a populated membership schema,
// then drives the real worker, website-account and CP handlers against it. No Boosty contact.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createControlPlaneMembershipHandler } from "../supabase/functions/_shared/control-plane-membership";
import { parseFundingSnapshot } from "../supabase/functions/_shared/funding-provider";
import { createBoostyMembershipHandler, type BoostyAdapter } from "../supabase/functions/_shared/boosty-membership";
import { linkCodeHash } from "../supabase/functions/_shared/boosty-link-code";
import { createWebsiteAccountHandler } from "../supabase/functions/_shared/website-account";
import { parseBoostyLinkStatus } from "../supabase/functions/_shared/boosty-account";
import type { BoostyApi, BoostySubscriber } from "../supabase/functions/_shared/boosty-api";
import type { BoostyCredential } from "../supabase/functions/_shared/boosty-credential";
import type { BoostyPolicy } from "../supabase/functions/_shared/boosty-policy";

const history = ["20260907212654_create_patreon_links.sql", "20260907220000_patreon_website_roles.sql", "20260907230000_atomic_live_console_assignments.sql",
    "202609080002_membership_onboarding.sql", "202609080003_membership_role_locking.sql", "20260908030000_patreon_event_reconciliation.sql",
    "20260910200000_membership_receipt_claims.sql", "202609110001_edge_owned_link_commit.sql", "20260919010000_actionable_patreon_retries.sql",
    "202609220001_patreon_allocation_webhooks.sql", "202609280003_account_owned_membership.sql", "202609280006_membership_paid_access_end.sql",
    "202610020001_membership_allocation_usd20.sql", "20261009170000_patreon_creator_token_refresh.sql", "20261109140000_membership_funding_providers.sql"];
const migration = "20261110120000_boosty_membership_adapter.sql";
const policy: BoostyPolicy = { blog: "coop-team", qualifyingLevelIds: ["555"], minimumPrice: 500, priceField: "RUB", creatorName: "Coop Team", maximumDropFraction: 0.25, policyVersion: "boosty-paid-v1" };
const syncToken = "a".repeat(64), syncSecret = "boosty-sync-secret-fixture";
const vault = `create schema vault;
    create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
    create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
    returns uuid language sql as $$ insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id; $$;
    create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
    returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id; $$;`;
type Row = Record<string, unknown>;

/** Builds a qualifying listed subscriber for the fixture policy. */
function subscriber(id: string, overrides: Partial<BoostySubscriber> = {}): BoostySubscriber {
    return { id, subscribed: true, blacklisted: false, levelId: "555", price: 500, ...overrides };
}

test("Boosty adapter links DM codes, decides evidence conservatively and serves CP v2 snapshots", async t => {
    const db = new PGlite();
    // Positional SQL and RPC helpers over the embedded database.
    const query = (sql: string, args: unknown[] = []) => db.query<Row>(sql, args);
    const rpc = async (name: string, args: unknown[]) => (await query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)).rows[0].result as Row;
    const sync = async (operation: string, input: Row) => (await query("select public.boosty_membership_sync($1,$2::jsonb) result", [operation, JSON.stringify(input)])).rows[0].result as Row | null;
    // Creates a website account with an initialized Patreon head.
    const fresh = async () => { const id = crypto.randomUUID(); await query("insert into auth.users(id) values($1)", [id]); await rpc("membership_fence", [id, null, false]); return id; };
    // Issues a link code for an account and returns the code and its hash.
    const issue = async (account: string, code = `BLC-${crypto.randomUUID().replace(/[^0-9a-f]/gu, "").slice(0, 5).toUpperCase().replace(/[ILOU]/gu, "7")}-ABCDE`) => {
        await rpc("boosty_link_begin", [account, null, await linkCodeHash(code)]);
        return { code, hash: await linkCodeHash(code) };
    };
    // Runs one leased worker operation sequence and always releases the lease.
    const leased = async <T>(work: (token: string) => Promise<T>) => {
        const lease = await sync("acquire", { blog: policy.blog });
        assert.ok(lease && typeof lease.token === "string");
        try { return await work(lease.token as string); } finally { await sync("release", { token: lease.token }); }
    };
    // Links one account to one Boosty user through the worker's link operation.
    const linkThrough = async (account: string, boostyUserId: string) => {
        const { hash } = await issue(account);
        return leased(token => sync("link", { token, dialogId: Number(boostyUserId), cursor: 10, matches: [{ messageId: 10, boostyUserId, codeHash: hash, messageAt: null }] }));
    };
    const deleted = new Set<string>();
    // Serves Auth admin lookups from the fixture and forwards closed RPC names to the embedded database.
    const edgeFetch: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        const account = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/u)?.[1];
        if (account) return deleted.has(account) ? new Response("missing", { status: 404 }) : Response.json({ id: account, identities: [] });
        if (path === "/auth/v1/user") return Response.json({ id: viewer, identities: [] });
        if (path === "/rest/v1/rpc/website_session_context") return Response.json({ impersonationId: null });
        const name = path.replace("/rest/v1/rpc/", "");
        assert.ok(["membership_funding_fence", "boosty_link_status", "boosty_link_begin", "boosty_unlink"].includes(name), name);
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

        await t.test("link codes: one pending per account, 5 per hour, hash-only storage and linked accounts refused", async () => {
            const id = await fresh();
            const first = await issue(id, "BLC-AAAAA-AAAAA");
            let status = await rpc("boosty_link_status", [id, null, first.hash]);
            assert.equal((status.pending as Row).matches, true);
            const second = await issue(id, "BLC-BBBBB-BBBBB");
            status = await rpc("boosty_link_status", [id, null, first.hash]);
            assert.equal((status.pending as Row).matches, false, "a new code replaces the pending one");
            assert.equal((await query("select count(*)::int n from boosty_membership.link_codes where code_hash=$1", [second.hash])).rows[0].n, 1);
            assert.equal((await query("select count(*)::int n from boosty_membership.link_codes where code_hash like 'BLC%'")).rows[0].n, 0);
            for (const code of ["BLC-CCCCC-CCCCC", "BLC-DDDDD-DDDDD", "BLC-EEEEE-EEEEE"]) await issue(id, code);
            await assert.rejects(issue(id, "BLC-FFFFF-FFFFF"), { code: "PT429" });
            await query("update boosty_membership.link_codes set window_started_at=window_started_at-interval '61 minutes' where account_id=$1", [id]);
            await issue(id, "BLC-FFFFF-FFFFF");
            await query("update boosty_membership.link_codes set expires_at=clock_timestamp()-interval '1 second', issued_at=clock_timestamp()-interval '31 minutes' where account_id=$1", [id]);
            assert.equal((await rpc("boosty_link_status", [id, null, null])).pending, null, "an expired code is not pending");
            await linkThrough(await fresh(), "9100").then(async () => {
                const linked = (await query("select account_id from boosty_membership.links where boosty_user_id='9100'")).rows[0].account_id as string;
                await assert.rejects(issue(linked, "BLC-GGGGG-GGGGG"), /already linked/u);
            });
        });

        await t.test("an exact pending code links the sender, bumps generation and emits a Boosty hint", async () => {
            const id = await fresh();
            const result = await linkThrough(id, "4242");
            assert.deepEqual(result, { linked: 1, refused: 0 });
            const head = (await query("select link_state, link_generation::text, revision::text, provider_user_id, evidence->>'verification' verification from public.membership_provider_heads where account_id=$1", [id])).rows[0];
            assert.deepEqual(head, { link_state: "linked", link_generation: "1", revision: "1", provider_user_id: "4242", verification: "unknown" });
            assert.deepEqual((await query("select provider, revision::text from public.membership_outbox where account_id=$1 and receipt_id is null", [id])).rows, [{ provider: "boosty", revision: "1" }]);
            const snapshot = await cpSnapshot(id);
            assert.equal(snapshot.linkState, "linked"); assert.equal(snapshot.providerUserId, "4242"); assert.equal(snapshot.verification, "unknown");
            assert.equal((await query("select next_poll_at <= clock_timestamp() due from boosty_membership.sync_state")).rows[0].due, true, "linking schedules a poll");
        });

        await t.test("expired, unknown and superseded codes never link; a Boosty user bound elsewhere is refused, not moved", async () => {
            const owner = await fresh(), other = await fresh();
            await linkThrough(owner, "7777");
            const { hash } = await issue(other);
            assert.deepEqual(await leased(token => sync("link", { token, dialogId: 77, cursor: 20, matches: [{ messageId: 20, boostyUserId: "7777", codeHash: hash, messageAt: null }] })), { linked: 0, refused: 1 });
            assert.equal((await query("select account_id from boosty_membership.links where boosty_user_id='7777'")).rows[0].account_id, owner);
            assert.equal((await rpc("boosty_link_status", [other, null, null])).outcome, "conflict");
            const late = await fresh(), lateCode = await issue(late);
            await query("update boosty_membership.link_codes set issued_at=clock_timestamp()-interval '40 minutes', expires_at=clock_timestamp()-interval '10 minutes' where account_id=$1", [late]);
            assert.deepEqual(await leased(token => sync("link", { token, dialogId: 78, cursor: 1, matches: [{ messageId: 1, boostyUserId: "7878", codeHash: lateCode.hash, messageAt: null }] })), { linked: 0, refused: 0 });
            const sentInTime = new Date(Date.now() - 20 * 60_000).toISOString();
            assert.deepEqual(await leased(token => sync("link", { token, dialogId: 78, cursor: 2, matches: [{ messageId: 2, boostyUserId: "7878", codeHash: lateCode.hash, messageAt: sentInTime }] })), { linked: 1, refused: 0 }, "a message sent while live links within the grace hour");
            const unknown = await linkCodeHash("BLC-ZZZZZ-ZZZZZ");
            assert.deepEqual(await leased(token => sync("link", { token, dialogId: 79, cursor: 1, matches: [{ messageId: 1, boostyUserId: "7979", codeHash: unknown, messageAt: null }] })), { linked: 0, refused: 0 });
            const raced = await fresh(), racedCode = await issue(raced);
            await query("insert into public.membership_provider_heads(account_id,provider,link_generation,revision,evidence) values($1,'boosty',3,3,public.membership_provider_empty_evidence('boosty'))", [raced]);
            assert.deepEqual(await leased(token => sync("link", { token, dialogId: 80, cursor: 1, matches: [{ messageId: 1, boostyUserId: "8080", codeHash: racedCode.hash, messageAt: null }] })), { linked: 0, refused: 1 });
            assert.equal((await rpc("boosty_link_status", [raced, null, null])).outcome, "superseded");
        });

        await t.test("dialog cursors read only new messages and skip dialogs whose newest message is over an hour old", async () => {
            const old = new Date(Date.now() - 2 * 3_600_000).toISOString(), recent = new Date().toISOString();
            const due = await leased(token => sync("dialogs", { token, dialogs: [{ dialogId: 501, lastMessageId: 9, lastMessageAt: old }, { dialogId: 502, lastMessageId: 9, lastMessageAt: recent }, { dialogId: 503, lastMessageId: 4, lastMessageAt: null }] }));
            assert.deepEqual(due, { due: [{ dialogId: 502, cursor: 0 }, { dialogId: 503, cursor: 0 }] });
            await leased(token => sync("link", { token, dialogId: 502, cursor: 9, matches: [] }));
            assert.deepEqual(await leased(token => sync("dialogs", { token, dialogs: [{ dialogId: 501, lastMessageId: 9, lastMessageAt: recent }, { dialogId: 502, lastMessageId: 9, lastMessageAt: recent }] })), { due: [] });
            await assert.rejects(leased(token => sync("link", { token, dialogId: 502, cursor: 9, matches: [{ messageId: 10, boostyUserId: "1", codeHash: "a".repeat(64), messageAt: null }] })), /invalid_boosty_match/u);
        });

        await t.test("the lease is exclusive, pins the blog and fences every other operation", async () => {
            const lease = await sync("acquire", { blog: policy.blog });
            assert.equal(await sync("acquire", { blog: policy.blog }), null);
            await assert.rejects(sync("linked", { token: crypto.randomUUID() }), /stale_boosty_lease/u);
            await sync("release", { token: lease!.token });
            await assert.rejects(sync("acquire", { blog: "another-blog" }), /boosty_blog_mismatch/u);
            await assert.rejects(sync("sql", { token: lease!.token }), /invalid_boosty_operation/u);
        });

        await t.test("evidence writes are validated, fenced by link generation and satisfy the CP Boosty grammar", async () => {
            const id = await fresh();
            await linkThrough(id, "3131");
            const verifiedAt = new Date().toISOString();
            const evidence = { verification: "qualifying", programId: "coop-team", memberId: null, tierIds: ["555"], verifiedAt, paidThroughAt: null, policyVersion: "boosty-paid-v1", evidenceSha256: "b".repeat(64) };
            const write = (results: Row[]) => leased(token => sync("evidence", { token, results }));
            assert.deepEqual(await write([{ accountId: id, providerUserId: "3131", linkGeneration: 1, evidence, absentSince: null }]), { written: 1 });
            const qualifying = await cpSnapshot(id);
            assert.deepEqual([qualifying.verification, qualifying.programId, qualifying.memberId, qualifying.tierIds, qualifying.policyVersion, qualifying.paidThroughAt], ["qualifying", "coop-team", null, ["555"], "boosty-paid-v1", null]);
            assert.deepEqual(await write([{ accountId: id, providerUserId: "3131", linkGeneration: 0, evidence, absentSince: null }]), { written: 0 }, "a stale link generation is skipped");
            for (const bad of [{ ...evidence, programId: "other" }, { ...evidence, policyVersion: "patreon-paid-usd20-v1" }, { ...evidence, memberId: "x" }, { ...evidence, tierIds: [] },
                { ...evidence, verification: "nonqualifying", tierIds: ["555"], paidAccessEndedAt: verifiedAt }, { ...evidence, verification: "nonqualifying", tierIds: [], paidAccessEndedAt: "2026-01-01T00:00:00.000Z" },
                { ...evidence, paidThroughAt: verifiedAt }, { ...evidence, extra: 1 }, { ...evidence, verification: "unverified" }]) {
                await assert.rejects(write([{ accountId: id, providerUserId: "3131", linkGeneration: 1, evidence: bad, absentSince: null }]), /invalid_boosty_result/u, JSON.stringify(bad));
            }
            const loss = { ...evidence, verification: "nonqualifying", tierIds: [], paidAccessEndedAt: verifiedAt };
            await write([{ accountId: id, providerUserId: "3131", linkGeneration: 1, evidence: loss, absentSince: verifiedAt }]);
            const lost = await cpSnapshot(id);
            assert.equal(lost.paidAccessEndedAt, verifiedAt); assert.deepEqual(lost.tierIds, []);
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

        await t.test("unlink and Auth deletion release the binding and fence the head", async () => {
            const id = await fresh(); viewer = id;
            await linkThrough(id, "5151");
            const unlinked = await rpc("boosty_unlink", [id, null]);
            assert.deepEqual([unlinked.linkState, unlinked.linkGeneration, unlinked.providerUserId], ["unlinked", "2", null]);
            assert.equal((await query("select count(*)::int n from boosty_membership.links where account_id=$1", [id])).rows[0].n, 0);
            await linkThrough(id, "5151");
            await query("delete from auth.users where id=$1", [id]); deleted.add(id);
            assert.equal((await query("select count(*)::int n from boosty_membership.links where boosty_user_id='5151'")).rows[0].n, 0);
            assert.equal((await cpSnapshot(id)).linkState, "account_deleted");
        });

        await t.test("the credential store seeds, rotates both secrets under its generation fence and rate-limits alerts", async () => {
            const credential = async (operation: string, input: Row) => (await query("select public.boosty_creator_credential($1,$2::jsonb) result", [operation, JSON.stringify(input)])).rows[0].result as Row;
            assert.deepEqual(await credential("read", {}), { configured: false, generation: 0 });
            await assert.rejects(credential("seed", { deviceId: "bad id", refreshToken: "r".repeat(20) }), /invalid_boosty_credential/u);
            assert.deepEqual(await credential("seed", { deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1" }), { seeded: true, generation: 1 });
            assert.deepEqual(await credential("read", {}), { configured: true, deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1", accessToken: null, generation: 1, refreshDue: true });
            assert.deepEqual(await credential("rotate", { generation: 1, accessToken: "access-token-fixture-2", refreshToken: "refresh-token-fixture-2", expiresIn: 86400 }), { rotated: true, generation: 2 });
            assert.deepEqual(await credential("rotate", { generation: 1, accessToken: "access-token-fixture-3", refreshToken: "refresh-token-fixture-3", expiresIn: 86400 }), { stale: true, generation: 2 });
            const read = await credential("read", {});
            assert.deepEqual([read.accessToken, read.refreshToken, read.refreshDue], ["access-token-fixture-2", "refresh-token-fixture-2", false]);
            assert.deepEqual(await credential("failed", { generation: 2, reason: "rejected" }), { recorded: true, alert: true });
            assert.deepEqual(await credential("failed", { generation: 2, reason: "unavailable" }), { recorded: true, alert: false });
            assert.equal((await query("select count(*)::int n from vault.secrets where name like 'boosty_creator_%'")).rows[0].n, 3);
        });

        await t.test("the worker links a DM code, polls a complete list and the CP sees qualifying evidence", async () => {
            const id = await fresh(); viewer = id;
            const account = createWebsiteAccountHandler({ supabaseUrl: "https://wfvqnijwuyqjibhlcrhz.supabase.co", serviceRoleKey: "synthetic-service-key", policy: null, boosty: policy, fetch: edgeFetch });
            // Sends one authenticated website-account request as the fixture viewer.
            const accountCall = async (body: unknown) => {
                const response = await account(new Request("https://edge-runtime.supabase.com/website-account", { method: "POST", headers: { Authorization: "Bearer synthetic-user-jwt", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
                return { status: response.status, body: await response.json() as Row };
            };
            const started = await accountCall({ operation: "boosty-start" });
            assert.equal(started.status, 200);
            const code = started.body.code as string;
            assert.match(code, /^BLC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/u);
            const pending = parseBoostyLinkStatus((await accountCall({ operation: "boosty-status", code })).body);
            assert.ok(pending.configured && pending.pending?.matches === true && !pending.linked && pending.creatorName === "Coop Team");
            for (const bad of [{ operation: "boosty-status", code: "nope" }, { operation: "boosty-start", extra: 1 }, { operation: "boosty-unlink", provider: "boosty" }]) assert.equal((await accountCall(bad)).status, 400);
            const now = Math.floor(Date.now() / 1000);
            const subscribers = new Map<string, BoostySubscriber>([["8888", subscriber("8888")]]);
            const calls: string[] = [];
            const api: BoostyApi = {
                dialogs: async offset => { calls.push(`dialogs:${offset}`); return { dialogs: [{ dialogId: "900", chatmateId: "8888", lastMessageId: "31", lastMessageAt: new Date(now * 1000).toISOString() }], nextOffset: null }; },
                messages: async dialogId => { calls.push(`messages:${dialogId}`); return [
                    { messageId: "30", authorId: "1", messageAt: null, code }, // the creator's own reply never links
                    { messageId: "31", authorId: "8888", messageAt: null, code }]; },
                subscribers: async offset => { calls.push(`subscribers:${offset}`); return { subscribers: [...subscribers.values()], total: subscribers.size }; },
            };
            const credential: BoostyCredential = { current: async () => "access", replace: async () => null, reportFailure: async () => undefined };
            const adapter: BoostyAdapter = { policy, credential, api };
            const alerts: string[] = [];
            const worker = createBoostyMembershipHandler({ adapter, syncSecret, rpc: sync, alert: async kind => { alerts.push(kind); } });
            const wake = () => worker(new Request("https://edge-runtime.supabase.com/boosty-membership", { method: "POST", headers: { "x-boosty-sync-key": syncSecret } }));
            assert.equal((await wake()).status, 200);
            assert.deepEqual(calls, ["dialogs:null", "messages:900", "subscribers:0"]);
            const linked = parseBoostyLinkStatus((await accountCall({ operation: "boosty-status" })).body);
            assert.ok(linked.configured && linked.linked && linked.verification === "qualifying");
            const snapshot = await cpSnapshot(id);
            assert.deepEqual([snapshot.providerUserId, snapshot.verification, snapshot.tierIds, snapshot.programId], ["8888", "qualifying", ["555"], "coop-team"]);
            // Not due again: the next wake reads dialogs only.
            calls.length = 0; assert.equal((await wake()).status, 200); assert.deepEqual(calls, ["dialogs:null"]);
            // Unsubscribed is explicit loss on the next complete poll.
            await query("update boosty_membership.sync_state set next_poll_at='-infinity'");
            subscribers.set("8888", subscriber("8888", { subscribed: false }));
            assert.equal((await wake()).status, 200);
            const lost = await cpSnapshot(id);
            assert.equal(lost.verification, "nonqualifying"); assert.equal(lost.paidAccessEndedAt, lost.verifiedAt);
            assert.deepEqual(alerts, []);
            assert.deepEqual((await accountCall({ operation: "boosty-unlink" })).body, { unlinked: true });
            assert.equal((await cpSnapshot(id)).linkState, "unlinked");
        });

        await t.test("the cron dispatcher posts one authenticated wakeup only when enabled, idle and configured", async () => {
            await db.exec(`create schema net; create table net.requests(id bigserial primary key, url text, headers jsonb, body jsonb, timeout integer);
                create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
                returns bigint language sql as $$ insert into net.requests(url, headers, body, timeout) values (url, headers, body, timeout_milliseconds) returning id; $$;`);
            const dispatch = async () => (await query("select boosty_membership.dispatch() id")).rows[0].id;
            assert.equal(await dispatch(), null, "disabled by default");
            await query("update boosty_membership.sync_state set dispatch_enabled=true, dispatch_until=null");
            assert.equal(await dispatch(), null, "missing Vault configuration");
            assert.equal((await query("select dispatch_error from boosty_membership.sync_state")).rows[0].dispatch_error, "dispatch_unavailable");
            await query("select vault.create_secret('https://attacker.invalid/functions/v1/boosty-membership','boosty_membership_function_url')");
            await query("select vault.create_secret($1,'boosty_membership_sync_secret')", [syncSecret]);
            assert.equal(await dispatch(), null, "only the canonical project URL is accepted");
            await query("update vault.secrets set secret='https://abcdefghijklmnopqrst.supabase.co/functions/v1/boosty-membership' where name='boosty_membership_function_url'");
            const lease = await sync("acquire", { blog: policy.blog });
            assert.equal(await dispatch(), null, "a live run is not woken again");
            await sync("release", { token: lease!.token });
            assert.ok(Number(await dispatch()) > 0);
            assert.deepEqual((await query("select url, headers, body, timeout from net.requests")).rows, [{ url: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/boosty-membership",
                headers: { "Content-Type": "application/json", "X-Boosty-Sync-Key": syncSecret }, body: {}, timeout: 60000 }]);
            assert.equal(await dispatch(), null, "a recent dispatch coalesces");
            assert.equal((await query("select count(*)::int n from net.requests")).rows[0].n, 1);
        });

        await t.test("only the service role reaches the adapter RPCs; nothing reaches the private schema", async () => {
            for (const role of ["anon", "authenticated", "service_role"]) {
                for (const table of ["sync_state", "links", "link_codes", "dialog_cursors", "absences", "creator_credential"]) {
                    assert.equal((await query("select has_table_privilege($1,$2,'select') allowed", [role, `boosty_membership.${table}`])).rows[0].allowed, false, `${role} ${table}`);
                }
                for (const fn of ["boosty_link_status(uuid,text,text)", "boosty_link_begin(uuid,text,text)", "boosty_unlink(uuid,text)", "boosty_membership_sync(text,jsonb)", "boosty_creator_credential(text,jsonb)"]) {
                    assert.equal((await query("select has_function_privilege($1,$2,'execute') allowed", [role, `public.${fn}`])).rows[0].allowed, role === "service_role", `${role} ${fn}`);
                }
                for (const fn of ["dispatch()", "link(jsonb)", "write_evidence(jsonb)", "acquire(jsonb)"]) {
                    assert.equal((await query("select has_function_privilege($1,$2,'execute') allowed", [role, `boosty_membership.${fn}`])).rows[0].allowed, false, `${role} ${fn}`);
                }
                assert.equal((await query("select has_function_privilege($1,'public.membership_provider_fence(uuid,text,text,boolean)','execute') allowed", [role])).rows[0].allowed, false);
            }
        });
    } finally { await db.close(); }
});
