import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("the VPS owner lookup returns only requested active accounts and is service-role only", async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create role service_role;
            create schema auth;
            create table auth.users (id uuid primary key, email text, deleted_at timestamptz);
            create table auth.identities (user_id uuid, provider text, provider_id text);
            insert into auth.users values
                ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner@example.test', null),
                ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, null),
                ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'deleted@example.test', now()),
                ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'unrelated@example.test', null);
            insert into auth.identities values
                ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'discord', '111111111111111111');
        `);
        await db.exec(await readFile("supabase/migrations/20261128050000_admin_vps_owner_labels.sql", "utf8"));
        for (const role of ["anon", "authenticated"]) {
            await db.exec(`set role ${role}`);
            await assert.rejects(db.query("select * from public.admin_vps_owner_labels('{}')"), { code: "42501" });
        }
        await db.exec("set role service_role");
        const ids = [
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ];
        const query = "select * from public.admin_vps_owner_labels($1::uuid[]) order by account_id";
        assert.deepEqual((await db.query(query, [ids])).rows, [
            { account_id: ids[0], label: "owner@example.test" },
            { account_id: ids[1], label: "111111111111111111" },
        ]);
        assert.deepEqual((await db.query(query, [[]])).rows, []);
        assert.deepEqual((await db.query(query, [Array(1001).fill(ids[0])])).rows, []);
    } finally {
        await db.close();
    }
});
