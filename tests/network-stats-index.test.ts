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
