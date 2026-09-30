import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createWebsiteAccountHandler } from "../supabase/functions/_shared/website-account";

const adminId = "11111111-1111-4111-8111-111111111111", targetId = "22222222-2222-4222-8222-222222222222";
const adminSession = "33333333-3333-4333-8333-333333333333", targetSession = "44444444-4444-4444-8444-444444444444";
const selection = "55555555-5555-4555-8555-555555555555", oauthSession = "66666666-6666-4666-8666-666666666666";

test("full impersonation executes account mutations as the target and refuses revoked native sessions before writing", async () => {
    for (const state of ["active", "ended", "expired"] as const) {
        const writes: unknown[] = [];
        const handler = createWebsiteAccountHandler({ supabaseUrl: "https://fixture.invalid", serviceRoleKey: "local-fixture-only", policy: null,
            fetch: async (input, init) => {
                const path = new URL(String(input)).pathname;
                if (path === "/auth/v1/user") return Response.json({ id: targetId, app_metadata: { role: "User" }, identities: [] });
                if (path === "/rest/v1/rpc/website_session_context") {
                    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer native-target-fixture");
                    return state === "ended" ? Response.json({}, { status: 403 }) : Response.json({ impersonationId: selection, actorId: adminId, targetId, expiresAt: state === "expired" ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z" });
                }
                assert.equal(path, "/rest/v1/rpc/membership_unlink"); writes.push(JSON.parse(String(init?.body)));
                return Response.json({ unlinked: true });
            } });
        const response = await handler(new Request("https://fixture.invalid/account", { method: "POST", headers: { authorization: "Bearer native-target-fixture", "content-type": "application/json" }, body: JSON.stringify({ operation: "unlink" }) }));
        assert.equal(response.status, state === "active" ? 200 : 503);
        assert.deepEqual(writes, state === "active" ? [{ p_account_id: targetId, p_discord_user_id: null }] : []);
    }
});

test("durable impersonation authorizes exact native sessions, records the real admin, and rejects expiry, exit, role revocation and anonymous access", async () => {
    const db = new PGlite();
    try {
        await db.exec(`create schema auth; create table auth.users(id uuid primary key, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb);
            create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id));
            create role anon; create role authenticated; create role service_role;
            create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
            create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
            grant usage on schema auth to authenticated; grant execute on function auth.jwt(), auth.uid() to authenticated;`);
        await db.query("insert into auth.users(id,raw_app_meta_data) values($1,'{\"role\":\"Admin\"}'),($2,'{\"role\":\"User\"}')", [adminId, targetId]);
        await db.query("insert into auth.sessions values($1,$2),($3,$4),($5,$4)", [adminSession, adminId, targetSession, targetId, oauthSession]);
        await db.exec(await readFile("supabase/migrations/202609300001_website_impersonation.sql", "utf8"));
        await db.exec("set role service_role");
        await db.query("select public.website_impersonation_begin($1,$2,$3,$4)", [selection, adminId, adminSession, targetId]);
        await db.query("select public.website_impersonation_bind($1,$2,$3,$4)", [selection, adminId, adminSession, targetSession]);
        await db.exec("reset role");
        const asSession = async (id: string, user = targetId) => {
            await db.exec("reset role");
            await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: id })]);
            await db.exec("set role authenticated");
        };
        const context = async () => (await db.query<{ value: { impersonationId: string | null; actorId?: string; targetId?: string } }>("select public.website_session_context('fixture.write',$1) value", [crypto.randomUUID()])).rows[0].value;
        await asSession(adminSession, adminId); assert.deepEqual(await context(), { impersonationId: null });
        await asSession(targetSession); assert.deepEqual(Object.fromEntries(Object.entries(await context()).filter(([key]) => key !== "expiresAt")), { impersonationId: selection, actorId: adminId, targetId });
        await assert.rejects(db.query("select * from public.website_impersonations"), /permission denied/);
        await assert.rejects(db.query("select public.website_impersonation_begin($1,$2,$3,$4)", [crypto.randomUUID(), targetId, oauthSession, adminId]), /permission denied/);
        await db.exec("reset role");
        const events = await db.query<{ actor_id: string; target_id: string; action: string }>("select g.actor_id,g.target_id,e.action from public.website_impersonation_events e join public.website_impersonations g on g.id=e.impersonation_id order by e.occurred_at");
        assert.deepEqual(events.rows, [{ actor_id: adminId, target_id: targetId, action: "started" }, { actor_id: adminId, target_id: targetId, action: "fixture.write" }]);
        await db.exec("set role service_role");
        await db.query("select public.website_impersonation_bind($1,$2,$3,$4)", [selection, adminId, adminSession, oauthSession]);
        await asSession(oauthSession); assert.equal((await context()).impersonationId, selection);
        await asSession(targetSession); await assert.rejects(context(), /insufficient_privilege|permission denied/);
        await asSession(oauthSession, adminId); await assert.rejects(context(), /insufficient_privilege|permission denied/);
        await db.exec("reset role");
        await db.query("delete from auth.sessions where id=$1", [adminSession]);
        await asSession(oauthSession); await assert.rejects(context(), /insufficient_privilege|permission denied/);
        await db.exec("reset role");
        await db.query("insert into auth.sessions values($1,$2)", [adminSession, adminId]);
        await db.query("update auth.users set raw_app_meta_data='{\"role\":\"Admin\"}' where id=$1", [targetId]);
        await db.exec("set role service_role");
        await assert.rejects(db.query("select public.website_impersonation_begin($1,$2,$3,$4)", [crypto.randomUUID(), targetId, oauthSession, adminId]), /insufficient_privilege|permission denied/);
        await db.exec("reset role");
        await db.query("update auth.users set raw_app_meta_data='{\"role\":\"User\"}' where id=$1", [targetId]);
        await db.exec("reset role");
        await db.query("update auth.users set raw_app_meta_data='{}' where id=$1", [adminId]);
        await asSession(oauthSession); await assert.rejects(context(), /insufficient_privilege|permission denied/);
        await db.exec("reset role");
        await db.query("update auth.users set raw_app_meta_data='{\"role\":\"Admin\"}' where id=$1", [adminId]);
        await db.query("update public.website_impersonations set created_at=clock_timestamp()-interval '31 minutes', expires_at=clock_timestamp()-interval '1 minute'");
        await asSession(oauthSession); await assert.rejects(context(), /insufficient_privilege|permission denied/);
        await db.exec("reset role");
        await db.query("update public.website_impersonations set created_at=clock_timestamp(), expires_at=clock_timestamp()+interval '30 minutes'");
        await db.exec("set role service_role");
        await db.query("select public.website_impersonation_end($1,$2,$3,$4)", [selection, adminId, adminSession, crypto.randomUUID()]);
        for (const id of [targetSession, oauthSession]) { await asSession(id); await assert.rejects(context(), /insufficient_privilege|permission denied/); }
        await db.exec("reset role; set role anon"); await assert.rejects(context(), /permission denied/);
    } finally { await db.close(); }
});
