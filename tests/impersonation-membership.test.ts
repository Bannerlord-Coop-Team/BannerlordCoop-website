import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createWebsiteAccountHandler } from "../supabase/functions/_shared/website-account";

const accountId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const discord = "123456789012345678";
const snapshot = { version: 1, accountId, discordUserId: null, patreonUserId: null, linkGeneration: "0", revision: "0", linkState: "unlinked",
    verification: "unverified", campaignId: null, memberId: null, tierIds: [], verifiedAt: null, paidThroughAt: null, policyVersion: "patreon-paid-usd20-v1", evidenceSha256: null };

test("account preview authenticates the real administrator, resolves exact target Auth identities, and invokes only the read-only RPC", async () => {
    for (const role of ["Admin", "User"]) {
        const calls: string[] = [];
        const handler = createWebsiteAccountHandler({ supabaseUrl: "https://fixture.invalid", serviceRoleKey: "local-fixture-only", policy: null,
            fetch: async (input, init) => {
                const path = new URL(String(input)).pathname; calls.push(path);
                if (path === "/auth/v1/user") return Response.json({ id: adminId, app_metadata: { role }, identities: [] });
                if (path === `/auth/v1/admin/users/${accountId}`) return Response.json({ id: accountId, identities: [] });
                assert.equal(path, "/rest/v1/rpc/membership_preview_status");
                assert.deepEqual(JSON.parse(String(init?.body)), { p_account_id: accountId, p_discord_user_id: null });
                return Response.json({ snapshot, pending: false, verificationPending: false });
            } });
        const response = await handler(new Request("https://fixture.invalid/account", { method: "POST", headers: { authorization: "Bearer local-fixture-only", "content-type": "application/json" },
            body: JSON.stringify({ operation: "preview-status", accountId }) }));
        assert.equal(response.status, role === "Admin" ? 200 : 403);
        if (role === "Admin") assert.equal((await response.json()).accountId, accountId);
        else assert.deepEqual(calls, ["/auth/v1/user"]);
    }
});

test("preview migration preserves initialized and uninitialized accounts, refuses stale evidence, and denies browser execution", async () => {
    const db = new PGlite();
    try {
        await db.exec("create schema auth; create table auth.users(id uuid primary key, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb, updated_at timestamptz); create role anon; create role authenticated; create role service_role;");
        for (const name of ["20260907212654_create_patreon_links.sql", "20260907220000_patreon_website_roles.sql", "20260907230000_atomic_live_console_assignments.sql", "202609080002_membership_onboarding.sql", "202609080003_membership_role_locking.sql", "20260908030000_patreon_event_reconciliation.sql", "20260910200000_membership_receipt_claims.sql"]) {
            await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
        }
        await db.query("insert into auth.users(id) values($1),($2)", [accountId, adminId]);
        await db.query("select public.membership_fence($1,$2,false)", [accountId, discord]);
        const tables = ["membership_heads", "membership_outbox", "patreon_oauth_states", "membership_completion_receipts"];
        const rows = () => Promise.all(tables.map(table => db.query(`select * from public.${table}`)));
        const before = await rows();
        await db.exec(await readFile("supabase/migrations/202609300001_website_user_preview.sql", "utf8"));
        const rpc = async (id: string, discordId: string | null) => (await db.query<{ result: { snapshot: unknown } | null }>("select public.membership_preview_status($1,$2) result", [id, discordId])).rows[0].result;
        const live = (await db.query<{ result: object }>("select public.membership_status($1,$2) result", [accountId, discord])).rows[0].result;
        assert.deepEqual(await rpc(accountId, discord), live);
        assert.equal(await rpc(accountId, null), null);
        assert.deepEqual((await rpc(adminId, null))?.snapshot, { ...snapshot, accountId: adminId });
        assert.deepEqual(await rows(), before);
        for (const role of ["anon", "authenticated"]) {
            await db.exec(`set role ${role}`);
            await assert.rejects(rpc(accountId, discord), /permission denied/);
            await db.exec("reset role");
        }
        await db.exec("set role service_role");
        assert.deepEqual(await rpc(accountId, discord), live);
        await assert.rejects(db.query("select * from public.membership_heads"), /permission denied/);
        await db.exec("reset role");
        assert.deepEqual(await rows(), before);
    } finally { await db.close(); }
});
