import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("presence migration keeps fresh counts and removes heartbeat writes from the wide table", async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create role service_role;
            create table public.server_statistics (
                session_id text primary key,
                mod_version text not null,
                commit_hash text not null,
                started_at timestamptz not null,
                player_count integer not null,
                last_seen_at timestamptz not null,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            );
            insert into public.server_statistics (
                session_id, mod_version, commit_hash, started_at, player_count,
                last_seen_at, updated_at
            ) values
                ('active-session', '1.0.0', 'abc', now(), 3, now(), now()),
                ('old-session', '1.0.0', 'abc', now() - interval '1 day', 50,
                 now() - interval '1 day', now() - interval '1 day');
            create or replace function public.report_server_statistics(
                text, text, text, timestamptz, integer
            ) returns text language sql as $$ select $1 $$;
            create or replace function public.get_network_stats()
            returns table(server_count bigint, player_count bigint)
            language sql as $$ select 0::bigint, 0::bigint $$;
        `);

        const migration = await readFile(
            "supabase/migrations/20261101000100_server_presence_telemetry.sql",
            "utf8",
        );
        await db.exec(migration);
        await db.exec(migration);

        assert.deepEqual(
            (await db.query("select * from public.get_network_stats()")).rows,
            [{ server_count: 1, player_count: 3 }],
        );
        assert.deepEqual(
            (await db.query("select count(*)::integer as total from public.server_statistics")).rows,
            [{ total: 2 }],
        );

        await db.query(
            "select public.report_server_statistics($1, $2, $3, $4::timestamptz, $5)",
            ["legacy-session", "1.1.0", "def", "2026-11-01T00:00:00Z", 4],
        );
        await db.query(
            "select public.report_server_presence($1, $2, $3, $4, $5::timestamptz, $6)",
            ["stable-server", "new-session", "1.1.0", "def", "2026-11-01T00:00:01Z", 7],
        );
        await db.query(
            "select public.report_server_presence($1, $2, $3, $4, $5::timestamptz, $6)",
            ["stable-server", "old-session", "1.0.0", "abc", "2026-10-01T00:00:00Z", 99],
        );

        assert.deepEqual(
            (await db.query("select server_id, session_id, player_count from public.server_presence order by server_id")).rows,
            [
                { server_id: "legacy:active-session", session_id: "active-session", player_count: 3 },
                { server_id: "legacy:legacy-session", session_id: "legacy-session", player_count: 4 },
                { server_id: "stable-server", session_id: "new-session", player_count: 7 },
            ],
        );
        assert.deepEqual(
            (await db.query("select * from public.get_network_stats()")).rows,
            [{ server_count: 3, player_count: 14 }],
        );
        assert.deepEqual(
            (await db.query(
                "select indexname from pg_indexes where schemaname = 'public' and tablename = 'server_presence'",
            )).rows,
            [
                { indexname: "server_presence_pkey" },
                { indexname: "server_presence_last_seen_at_idx" },
            ],
        );
    } finally {
        await db.close();
    }
});
