import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Matrix: seeded rows receive semantic keys; edited/new content stays unkeyed; all original data/access survives.
test("roadmap translation migration preserves identities, prose, order, status and public access", async () => {
    const db = new PGlite();
    const dictionary = JSON.parse(await readFile("src/app/lib/localization/dictionaries/en/home.json", "utf8"));
    try {
        await db.exec("create role anon; create role authenticated; create role service_role;");
        for (const name of ["20260914130215_create_roadmap.sql", "20260914132950_rename_roadmap_unstable_to_experimental.sql"]) {
            await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
        }
        // Existing live progress/order may differ from the seed; neither controls translation identity.
        await db.exec("update roadmap_items set status = 'in_progress', sort_order = 999 where title = 'Arena';");
        const seedItems = (await db.query("select * from roadmap_items order by id")).rows;
        const seedMilestones = (await db.query("select * from roadmap_milestones order by id")).rows;
        await db.exec("insert into roadmap_milestones (title, sort_order) values ('Future milestone', 999);");
        await db.exec("insert into roadmap_items (milestone_id, title, description, status) select id, 'Trading', 'Edited source prose', 'planned' from roadmap_milestones where title = 'v0.1';");
        const itemsBefore = (await db.query("select * from roadmap_items order by id")).rows;
        const milestonesBefore = (await db.query("select * from roadmap_milestones order by id")).rows;
        const policiesBefore = (await db.query("select * from pg_policies where tablename like 'roadmap_%' order by tablename")).rows;
        await db.exec(await readFile("supabase/migrations/20261002150000_roadmap_translation_keys.sql", "utf8"));
        const items = (await db.query<Record<string, unknown>>("select * from roadmap_items order by id")).rows;
        const milestones = (await db.query<Record<string, unknown>>("select * from roadmap_milestones order by id")).rows;
        assert.deepEqual(items.map(({ title_translation_key, description_translation_key, ...source }) => source), itemsBefore);
        assert.deepEqual(milestones.map(({ title_translation_key, ...source }) => source), milestonesBefore);
        assert.equal(seedItems.length, 39);
        assert.equal(seedMilestones.length, 4);
        for (const row of items) {
            if (row.description === "Edited source prose") {
                assert.equal(row.title_translation_key, null);
                assert.equal(row.description_translation_key, null);
                continue;
            }
            assert.match(String(row.title_translation_key), /^roadmap\.item\.[a-z-]+\.title$/);
            assert.equal(dictionary[String(row.title_translation_key)], row.title);
            assert.equal(row.description_translation_key ? dictionary[String(row.description_translation_key)] : "", row.description);
        }
        for (const row of milestones) {
            if (row.title === "Future milestone") {
                assert.equal(row.title_translation_key, null);
                continue;
            }
            assert.equal(dictionary[String(row.title_translation_key)], row.title);
        }
        assert.deepEqual((await db.query("select * from pg_policies where tablename like 'roadmap_%' order by tablename")).rows, policiesBefore);
        assert.deepEqual((await db.query("select relrowsecurity from pg_class where relname in ('roadmap_items', 'roadmap_milestones')")).rows, [{ relrowsecurity: true }, { relrowsecurity: true }]);
        for (const role of ["anon", "authenticated"]) {
            for (const table of ["roadmap_items", "roadmap_milestones"]) {
                assert.deepEqual((await db.query(`select has_table_privilege('${role}', '${table}', 'select') readable, has_table_privilege('${role}', '${table}', 'update') writable`)).rows, [{ readable: true, writable: false }]);
            }
        }
    } finally {
        await db.close();
    }
});
