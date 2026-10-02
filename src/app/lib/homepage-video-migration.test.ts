import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Matrix: unchanged seed fields receive keys; edited/custom/new fields stay unkeyed; source data/access survives.
for (const edited of [false, true]) {
    // Applies only homepage migrations in disposable PostgreSQL and checks data and access preservation.
    test(`homepage media keys preserve source data/access (edited seed: ${edited})`, async () => {
        const db = new PGlite();
        const dictionary = JSON.parse(await readFile("src/app/lib/localization/dictionaries/en/home.json", "utf8"));
        try {
            await db.exec("create role anon; create role authenticated; create role service_role;");
            for (const name of ["20260910162653_create_homepage_videos.sql", "20260910164925_homepage_video_publication_dates.sql"]) {
                await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
            }
            // An unrelated row with identical editorial text must not inherit the seed's identities.
            await db.exec(`insert into homepage_videos (source, href, title, description, thumbnail, thumbnail_alt, category, duration)
                select source, 'https://example.com/custom', title, description, thumbnail, thumbnail_alt, category, duration
                from homepage_videos where source = 'custom';
                update homepage_videos set sort_order = 999, published = false where source = 'custom';`);
            if (edited) {
                await db.exec(`update homepage_videos set description = 'Edited description', thumbnail_alt = 'Edited alternative', category = 'Edited category'
                    where href = 'https://www.twitch.tv/videos/2827818732?t=04h20m50s';`);
            }
            const before = (await db.query("select * from homepage_videos order by id")).rows;
            const policiesBefore = (await db.query("select * from pg_policies where tablename = 'homepage_videos'")).rows;
            const grantsBefore = (await db.query("select * from information_schema.role_table_grants where table_name = 'homepage_videos' order by grantee, privilege_type")).rows;
            await db.exec(await readFile("supabase/migrations/20260930160000_homepage_video_translation_keys.sql", "utf8"));
            const rows = (await db.query<Record<string, unknown>>("select * from homepage_videos order by id")).rows;
            assert.equal(rows.length, 9);
            assert.deepEqual(rows.map(({ description_translation_key, thumbnail_alt_translation_key, category_translation_key, ...source }) => source), before);
            for (const row of rows) {
                const mapped = !edited && row.href === "https://www.twitch.tv/videos/2827818732?t=04h20m50s";
                for (const [field, suffix] of [["description", "description"], ["thumbnail_alt", "thumbnailAlt"], ["category", "category"]]) {
                    const key = row[`${field}_translation_key`];
                    assert.equal(key, mapped ? `media.captainfracas-twitch.${suffix}` : null);
                    if (mapped) assert.equal(dictionary[String(key)], row[field]);
                }
            }
            await db.exec("insert into homepage_videos (source, href, title, thumbnail, thumbnail_alt) values ('custom', 'https://example.com/new-custom', 'New title', 'https://example.com/image.jpg', 'New alternative');");
            assert.deepEqual((await db.query("select description_translation_key, thumbnail_alt_translation_key, category_translation_key from homepage_videos where href = 'https://example.com/new-custom'")).rows,
                [{ description_translation_key: null, thumbnail_alt_translation_key: null, category_translation_key: null }]);
            assert.deepEqual((await db.query("select * from pg_policies where tablename = 'homepage_videos'")).rows, policiesBefore);
            assert.deepEqual((await db.query("select * from information_schema.role_table_grants where table_name = 'homepage_videos' order by grantee, privilege_type")).rows, grantsBefore);
            assert.deepEqual((await db.query("select relrowsecurity from pg_class where relname = 'homepage_videos'")).rows, [{ relrowsecurity: true }]);
        } finally {
            await db.close();
        }
    });
}
