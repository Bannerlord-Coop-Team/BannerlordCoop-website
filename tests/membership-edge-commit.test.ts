// Embedded PostgreSQL executes the real forward migration and RPCs without any remote credentials.
// PGlite is single-connection: real multi-session contention remains in membership-postgres.test.ts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createPatreonHandler } from "../supabase/functions/_shared/patreon";
import { createWebsiteAccountHandler } from "../supabase/functions/_shared/website-account";
import { sha256 } from "../supabase/functions/_shared/membership";

const migration = "202609110001_edge_owned_link_commit.sql";
const discord = "123456789012345678";
const differentDiscord = "999456789012345678";
const token = () => crypto.randomUUID().replaceAll("-", "").repeat(2);
test("edge-owned link commit with recovery table actually absent", async t => {
    const db = new PGlite();
    const query = (sql: string, args: unknown[] = []) => db.query<Record<string, unknown>>(sql, args);
    const rpc = async (name: string, args: unknown[]) => (await query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)).rows[0].result as Record<string, unknown>;
    const fresh = async () => {
        const id = crypto.randomUUID();
        await query("insert into auth.users(id) values($1)", [id]);
        await rpc("membership_fence", [id, null, false]);
        return id;
    };
    const begin = async (id: string, raw = token()) => {
        const hash = await sha256(raw);
        await rpc("membership_begin", [id, null, crypto.randomUUID(), hash, "/servers"]);
        return { raw, hash };
    };
    const stage = async (id: string, patreon = "123") => {
        const attempt = await begin(id);
        // Simulates normalized evidence after the provider callback, not a browser write.
        await query("update public.patreon_oauth_states set kind='complete',patreon_user_id=$2,evidence=public.membership_empty_evidence() where token_hash=$1", [attempt.hash, patreon]);
        return attempt;
    };
    try {
        await db.exec("create schema auth; create table auth.users(id uuid primary key, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb, updated_at timestamptz); create role anon; create role authenticated; create role service_role;");
        for (const name of ["20260907212654_create_patreon_links.sql", "20260907220000_patreon_website_roles.sql", "20260907230000_atomic_live_console_assignments.sql", "202609080002_membership_onboarding.sql", "202609080003_membership_role_locking.sql", "20260908030000_patreon_event_reconciliation.sql", "20260910200000_membership_receipt_claims.sql"]) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
        const old = await fresh(), pending = await fresh();
        const receiptToken = token(), pendingToken = token();
        await rpc("membership_discord_begin", [old, receiptToken, crypto.randomUUID(), "/servers"]);
        await rpc("membership_discord_callback", [old, receiptToken, discord]);
        await rpc("membership_discord_confirm", [old, receiptToken, discord]);
        await rpc("membership_discord_begin", [pending, pendingToken, crypto.randomUUID(), "/account"]);
        const history = (await query("select * from public.discord_link_requests where token_hash=$1", [receiptToken])).rows;
        const patreonOwner = await fresh(), legacyToken = token();
        await query("insert into public.patreon_oauth_states(token_hash,kind,user_id,operation_id,expected_generation,expires_at,return_path,patreon_user_id,evidence) values($1,'complete',$2,$3,0,clock_timestamp()+interval '10 minutes','/account','99',public.membership_empty_evidence())", [legacyToken, patreonOwner, crypto.randomUUID()]);
        const legacyReceipt = await rpc("membership_complete", [patreonOwner, null, legacyToken]);
        assert.equal((await query("select acknowledged from public.membership_recovery_intents where account_id=$1 and provider='patreon'", [patreonOwner])).rows[0].acknowledged, false);
        await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
        await t.test("forward migration discards only unfinished Discord authority, preserves receipts and removes all active SQL dependencies", async () => {
            assert.deepEqual((await query("select * from public.discord_link_requests where token_hash=$1", [receiptToken])).rows, history);
            assert.deepEqual(await rpc("membership_complete", [patreonOwner, null, legacyToken]), legacyReceipt);
            await rpc("membership_unlink", [patreonOwner, null]);
            await begin(patreonOwner); // The formerly unacknowledged intent cannot block reconnect.
            assert.equal((await query("select * from public.discord_link_requests where token_hash=$1", [pendingToken])).rows.length, 0);
            assert.equal((await query("select to_regclass('public.membership_recovery_intents') absent")).rows[0].absent, null);
            assert.equal((await query("select count(*)::int n from pg_proc where prosrc like '%membership_recovery_intents%'")).rows[0].n, 0);
            assert.equal((await query("select to_regprocedure('public.membership_recovery(uuid,text,text,uuid,boolean,text)') absent")).rows[0].absent, null);
            for (const fn of ["membership_begin(uuid,text,uuid,text,text)", "membership_discord_begin(uuid,text,uuid,text)", "membership_discord_callback(uuid,text,text)", "membership_discord_confirm(uuid,text,text)", "membership_complete(uuid,text,text)"]) {
                for (const role of ["anon", "authenticated"]) assert.equal((await query("select has_function_privilege($1,$2,'execute') allowed", [role, `public.${fn}`])).rows[0].allowed, false);
                assert.equal((await query("select has_function_privilege('service_role',$1,'execute') allowed", [`public.${fn}`])).rows[0].allowed, true);
            }
        });
        await t.test("initial Patreon commit, response-loss replay, unlink/reconnect and immutable old receipt", async () => {
            const id = await fresh(), first = await stage(id);
            const result = await rpc("membership_complete", [id, null, first.hash]);
            assert.equal(result.linked, true);
            assert.deepEqual(await rpc("membership_complete", [id, null, first.hash]), result);
            await rpc("membership_unlink", [id, null]);
            const second = await stage(id, "124");
            await rpc("membership_complete", [id, null, second.hash]);
            assert.deepEqual(await rpc("membership_complete", [id, null, first.hash]), result);
            assert.equal((await query("select patreon_user_id from public.patreon_accounts where user_id=$1", [id])).rows[0].patreon_user_id, "124");
            assert.equal((await query("select count(*)::int n from public.membership_completion_receipts where account_id=$1", [id])).rows[0].n, 2);
        });
        await t.test("expired/failed Patreon attempts permit replacement; older callback generations cannot commit or reissue", async () => {
            const id = await fresh(), expired = await stage(id, "200");
            await query("update public.patreon_oauth_states set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1", [expired.hash]);
            await assert.rejects(rpc("membership_complete", [id, null, expired.hash]), /Invalid completion authority/);
            const stale = await stage(id, "200");
            const context = (await query("select * from public.patreon_oauth_states where token_hash=$1", [stale.hash])).rows[0];
            const newer = await stage(id, "200");
            await assert.rejects(rpc("membership_complete", [id, null, stale.hash]), /generation changed/);
            await rpc("membership_unlink", [id, null]);
            await assert.rejects(rpc("membership_complete", [id, null, newer.hash]));
            await assert.rejects(query("insert into public.patreon_oauth_states(token_hash,kind,user_id,operation_id,expected_generation,expires_at,return_path) values($1,'state',$2,$3,$4,clock_timestamp()+interval '10 minutes','/servers')", [token(), id, context.operation_id, context.expected_generation]), /generation changed/);
            const retry = await stage(id, "200");
            assert.equal((await rpc("membership_complete", [id, null, retry.hash])).linked, true);
        });
        await t.test("Patreon atomic failure preserves authority/head/outbox, foreign account and uniqueness refuse", async () => {
            const id = await fresh(), foreign = await fresh(), attempt = await stage(id, "300");
            await assert.rejects(rpc("membership_complete", [foreign, null, attempt.hash]), /Invalid completion authority/);
            const snapshot = async () => (await query("select (select to_jsonb(h) from public.membership_heads h where account_id=$1) head,(select jsonb_agg(to_jsonb(o)) from public.membership_outbox o where account_id=$1) outbox", [id])).rows;
            const before = await snapshot();
            await db.exec("create function public.test_fail() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$; create trigger test_fail before insert on public.membership_completion_receipts for each row execute function public.test_fail()");
            await assert.rejects(rpc("membership_complete", [id, null, attempt.hash]), /injected/);
            assert.deepEqual(await snapshot(), before);
            assert.equal((await query("select * from public.patreon_accounts where user_id=$1", [id])).rows.length, 0);
            assert.equal((await query("select * from public.patreon_oauth_states where token_hash=$1", [attempt.hash])).rows.length, 1);
            await db.exec("drop trigger test_fail on public.membership_completion_receipts; drop function public.test_fail()");
            await rpc("membership_complete", [id, null, attempt.hash]);
            await assert.rejects(rpc("membership_complete", [foreign, null, attempt.hash]), /Completion account conflict/);
            const duplicate = await stage(foreign, "300");
            await assert.rejects(rpc("membership_complete", [foreign, null, duplicate.hash]), /unique/);
        });
        await t.test("Discord initial link, disconnect/reconnect, failed/expired replacement and generation reuse", async () => {
            const id = await fresh(), foreign = await fresh(), first = token();
            await rpc("membership_discord_begin", [id, first, crypto.randomUUID(), "/account"]);
            const initialGeneration = (await query("select callback_generation from public.discord_link_requests where token_hash=$1", [first])).rows[0].callback_generation;
            await assert.rejects(rpc("membership_discord_check", [foreign, first]));
            await assert.rejects(rpc("membership_discord_confirm", [id, first, discord]), /callback authority/);
            await rpc("membership_discord_callback", [id, first, discord]);
            const stampedGeneration = (await query("select callback_generation from public.discord_link_requests where token_hash=$1", [first])).rows[0].callback_generation;
            assert.ok(Number(stampedGeneration) > Number(initialGeneration));
            assert.deepEqual(await rpc("membership_discord_callback", [id, first, discord]), { verified: true });
            await assert.rejects(rpc("membership_discord_confirm", [id, first, differentDiscord]), /callback authority/);
            const receipt = await rpc("membership_discord_confirm", [id, first, discord]);
            await rpc("membership_fence", [id, null, false]); // Auth independently unlinked.
            await assert.rejects(rpc("membership_discord_confirm", [id, first, null]), /linking conflict/);
            const second = token();
            await rpc("membership_discord_begin", [id, second, crypto.randomUUID(), "/servers"]);
            await rpc("membership_discord_callback", [id, second, discord]);
            await rpc("membership_discord_confirm", [id, second, discord]);
            assert.deepEqual(await rpc("membership_discord_confirm", [id, first, discord]), receipt);
            const failed = token(), expired = token(), next = token();
            await rpc("membership_discord_begin", [id, failed, crypto.randomUUID(), "/account"]);
            await rpc("membership_discord_begin", [id, expired, crypto.randomUUID(), "/account"]);
            await assert.rejects(rpc("membership_discord_callback", [id, failed, discord]), /Invalid callback/);
            await query("update public.discord_link_requests set expires_at=clock_timestamp() where token_hash=$1", [expired]);
            await assert.rejects(rpc("membership_discord_callback", [id, expired, discord]), /Invalid callback/);
            await rpc("membership_discord_begin", [id, next, crypto.randomUUID(), "/account"]);
            assert.equal((await rpc("membership_discord_check", [id, next])).valid, true);
        });
        await t.test("Discord first-confirmation write failure rolls back admission and permits an exact retry", async () => {
            const id = await fresh(), first = token();
            await rpc("membership_discord_begin", [id, first, crypto.randomUUID(), "/account"]);
            await rpc("membership_discord_callback", [id, first, discord]);
            const snapshot = async () => (await query("select (select to_jsonb(h) from public.membership_heads h where account_id=$1) head,(select jsonb_agg(to_jsonb(r)) from public.discord_link_requests r where account_id=$1) requests", [id])).rows;
            const before = await snapshot();
            await db.exec("create function public.test_missing_confirm() returns trigger language plpgsql as $$ begin return null; end $$; create trigger test_missing_confirm before update of confirmed_at on public.discord_link_requests for each row execute function public.test_missing_confirm()");
            await assert.rejects(rpc("membership_discord_confirm", [id, first, discord]), /expired or missing/);
            assert.deepEqual(await snapshot(), before);
            await db.exec("drop trigger test_missing_confirm on public.discord_link_requests; drop function public.test_missing_confirm()");
            assert.equal((await rpc("membership_discord_confirm", [id, first, discord])).confirmed, true);
        });
        await t.test("Discord stale callbacks after status drift, Patreon supersession, unlink and newer Discord attempt refuse", async () => {
            for (const mutation of ["status", "patreon", "unlink", "discord"]) {
                const id = await fresh(), first = token();
                if (mutation === "unlink") await begin(id);
                await rpc("membership_discord_begin", [id, first, crypto.randomUUID(), "/account"]);
                if (mutation === "status") await rpc("membership_fence", [id, discord, false]);
                if (mutation === "patreon") await begin(id);
                if (mutation === "unlink") await rpc("membership_unlink", [id, null]);
                if (mutation === "discord") await rpc("membership_discord_begin", [id, token(), crypto.randomUUID(), "/account"]);
                await assert.rejects(rpc("membership_discord_callback", [id, first, discord]));
                await assert.rejects(rpc("membership_discord_confirm", [id, first, discord]));
            }
            const id = await fresh(), first = token();
            await rpc("membership_discord_begin", [id, first, crypto.randomUUID(), "/account"]);
            await rpc("membership_discord_callback", [id, first, discord]);
            await rpc("membership_fence", [id, null, false]);
            await assert.rejects(rpc("membership_discord_callback", [id, first, discord]), /superseded/);
            await assert.rejects(rpc("membership_discord_confirm", [id, first, discord]), /callback authority/);
        });
        await t.test("authenticated Edge completes real SQL, rejects account switching and removed recovery APIs", async () => {
            const owner = await fresh(), other = await fresh(), attempt = await stage(owner, "400");
            let current = other;
            let authDiscord: string | null = null;
            const fetcher: typeof fetch = async (input, init) => {
                const path = new URL(String(input)).pathname;
                if (path === "/auth/v1/user") return Response.json({ id: current, identities: authDiscord ? [{ provider: "discord", identity_data: { provider_id: authDiscord } }] : [] });
                const name = path.replace("/rest/v1/rpc/", "");
                assert.ok(["membership_complete", "membership_unlink", "membership_status", "membership_discord_begin", "membership_discord_check", "membership_discord_confirm"].includes(name));
                const args = JSON.parse(String(init?.body));
                try { return Response.json(await rpc(name, Object.values(args))); }
                catch { return Response.json({ message: "refused" }, { status: 400 }); }
            };
            const config = { supabaseUrl: "https://fixture.invalid", serviceRoleKey: "synthetic", clientId: "synthetic", clientSecret: "synthetic", redirectUri: "https://fixture.invalid/callback", siteUrl: "https://website.invalid", fetch: fetcher, policy: null };
            const complete = createPatreonHandler(config, "complete"), account = createWebsiteAccountHandler(config);
            const request = (body: unknown) => new Request("https://fixture.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: JSON.stringify(body) });
            assert.equal((await complete(request({ token: attempt.raw }))).status, 503);
            current = owner;
            const result = await (await complete(request({ token: attempt.raw }))).json();
            assert.equal(result.linked, true);
            assert.deepEqual(await (await complete(request({ token: attempt.raw }))).json(), result);
            await account(request({ operation: "unlink" }));
            assert.deepEqual(await (await complete(request({ token: attempt.raw }))).json(), result);
            assert.equal((await query("select * from public.patreon_accounts where user_id=$1", [owner])).rows.length, 0);
            for (const operation of ["recovery-status", "recovery-resolve"]) assert.equal((await account(request({ operation, provider: "patreon", token: null }))).status, 400);
            const started = await (await account(request({ operation: "discord-start", returnPath: "/account" }))).json();
            const hash = await sha256(started.token);
            await rpc("membership_discord_callback", [owner, hash, discord]);
            // Auth may change after the website's attestation but before Edge sees it.
            authDiscord = differentDiscord;
            assert.equal((await account(request({ operation: "discord-confirm", token: started.token }))).status, 503);
            authDiscord = discord; current = other;
            assert.equal((await account(request({ operation: "discord-confirm", token: started.token }))).status, 503);
            current = owner;
            assert.equal((await (await account(request({ operation: "discord-confirm", token: started.token }))).json()).confirmed, true);
        });
    } finally { await db.close(); }
});
