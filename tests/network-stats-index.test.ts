import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("network statistics index preserves updated_at freshness and uses an indexed range", async () => {
    const db = new PGlite();
    try {
        await db.exec(`create table public.server_statistics (
            session_id text primary key, updated_at timestamptz, last_seen_at timestamptz, player_count integer
        );
        insert into public.server_statistics
            select n::text, now()-interval '1 day', now()-interval '1 day', 1 from generate_series(1,20000) n;
        insert into public.server_statistics values
            ('active',now(),now()-interval '1 day',3),
            ('old',now()-interval '1 day',now(),100);
        create index server_statistics_last_seen_at_idx on public.server_statistics(last_seen_at);
        create index server_statistics_last_seen_at_session_id_idx on public.server_statistics(last_seen_at,session_id);
        analyze public.server_statistics;`);
        const query = `select count(*)::integer as server_count, coalesce(sum(player_count),0)::integer as player_count
            from public.server_statistics where updated_at >= now()-interval '2 minutes'`;
        const before = (await db.query(query)).rows;
        assert.deepEqual(before, [{server_count:1,player_count:3}]);
        const sql = await readFile("supabase/migrations/202609100011_network_stats_updated_at_index.sql", "utf8");
        await db.exec(sql);
        await db.exec(sql);
        const cleanup = await readFile("supabase/migrations/202609200001_drop_unused_server_statistics_indexes.sql", "utf8");
        await db.exec(cleanup);
        await db.exec(cleanup);
        await db.exec('analyze public.server_statistics');
        assert.deepEqual((await db.query(query)).rows,before);
        assert.match(JSON.stringify((await db.query(`explain (format json) ${query}`)).rows), /server_statistics_updated_at_idx/);
        assert.deepEqual((await db.query(`select
            to_regclass('public.server_statistics_updated_at_idx') is not null as updated_at,
            to_regclass('public.server_statistics_last_seen_at_idx') is null as last_seen_at,
            to_regclass('public.server_statistics_last_seen_at_session_id_idx') is null as last_seen_at_session_id`)).rows,
        [{updated_at:true,last_seen_at:true,last_seen_at_session_id:true}]);
        assert.deepEqual((await db.query('select count(*)::integer as total from public.server_statistics')).rows,[{total:20002}]);
    } finally { await db.close(); }
});

test("network statistics replaces the BRIN only after validating the smaller range", async () => {
    const db = new PGlite();
    try {
        await db.exec(`create table public.server_statistics (
            session_id text primary key, updated_at timestamptz, last_seen_at timestamptz, player_count integer
        );
        insert into public.server_statistics values
            ('active', now(), now()-interval '1 day', 3),
            ('old', now()-interval '1 day', now(), 100);
        create index server_statistics_updated_at_brin_idx on public.server_statistics using brin (updated_at);
        create index server_statistics_updated_at_brin8_idx on public.server_statistics using brin (updated_at)
          with (pages_per_range = 16);`);
        const migration = await readFile("supabase/migrations/20261126014500_network_stats_brin_range.sql", "utf8");
        const statements = migration.split(/\n(?=set |create index |do \$guard\$|drop index )/);
        const apply = async () => {
            for (const statement of statements) await db.exec(statement);
        };
        await assert.rejects(apply, (error: { code?: string }) => error.code === "55000");
        assert.deepEqual((await db.query(`select to_regclass('public.server_statistics_updated_at_brin_idx')
            is not null as old_index`)).rows, [{old_index:true}]);

        await db.exec("drop index public.server_statistics_updated_at_brin8_idx");
        await apply();
        await apply();
        assert.deepEqual((await db.query(`select c.reloptions, i.indisvalid,
            to_regclass('public.server_statistics_updated_at_brin_idx') is null as old_index_removed
            from pg_class c join pg_index i on i.indexrelid=c.oid
            where c.oid='public.server_statistics_updated_at_brin8_idx'::regclass`)).rows,
            [{reloptions:["pages_per_range=8"],indisvalid:true,old_index_removed:true}]);
        assert.deepEqual((await db.query(`select count(*)::integer as server_count, sum(player_count)::integer as player_count
            from public.server_statistics where updated_at >= now()-interval '2 minutes'`)).rows,
            [{server_count:1,player_count:3}]);
    } finally { await db.close(); }
});
