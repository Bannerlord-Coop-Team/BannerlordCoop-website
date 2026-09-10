import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("membership shared upgrade inventory pins own history and exact new CP Git mirrors without historical rewrites", async () => {
    const inventory = JSON.parse(await readFile("docs/membership-migration-inventory.json", "utf8"));
    const expected = inventory.migrations as { version: string; websitePath: string; websiteSha256: string; websiteBytes: number; cpSha256?: string; cpBytes?: number; representationException: boolean }[];
    assert.equal(inventory.cpSourceHead, "4160f7bda49c6dd7dab57b912811c793dec90ac3");
    assert.equal(inventory.websiteBaselineHead, "ba0d34cb9023360bb13632112bc4509484c096b6");
    assert.equal(expected.length,30); assert.equal(new Set(expected.map(e=>e.version)).size,30);
    assert.equal(expected.filter(e=>!e.representationException).length,20);
    assert.equal(inventory.integratedWebsiteMainHead,"f012d9412d98a1e8f50bcc3887c655a813959500");
    for (const version of ["20260907220000","20260907230000"]) {
        const entry=inventory.migrations.find((e:{version:string})=>e.version===version);
        assert.deepEqual(entry.provenance,{websiteHead:"f012d9412d98a1e8f50bcc3887c655a813959500",pullRequest:104});
        assert.equal(entry.releaseClassification,"required already-applied external history; NEVER replay");
    }
    const retiredCommunityServers=inventory.migrations.find((e:{version:string})=>e.version==="20260910213320");
    assert.deepEqual(retiredCommunityServers.provenance,{
        projectReference:"wfvqnijwuyqjibhlcrhz",migrationVersion:"20260910213320",
        migrationName:"drop_unused_community_servers",source:"supabase_migrations.schema_migrations.statements",
    });
    assert.equal(retiredCommunityServers.releaseClassification,"required already-applied external history; NEVER replay");
    assert.deepEqual((await readdir("supabase/migrations")).filter(f=>f.endsWith(".sql") && !["202609100010_control_plane_monitor_indexes.sql", "202609100011_network_stats_updated_at_index.sql", "202609100001_control_plane_web_admin_principals.sql", "20260910162653_create_homepage_videos.sql", "20260910164925_homepage_video_publication_dates.sql"].includes(f)).sort(),expected.map(e=>e.websitePath.split("/").at(-1)).sort());
    assert.deepEqual(expected.filter(e=>e.representationException).map(e=>e.version),["20260821074242","20260821083000","20260821100640","20260821112235","202608240001","202608260001","202608260002","202608260003","202608260004","202608260005"]);
    for (const entry of expected) {
        // Canonical Git text bytes; CRLF checkouts are not new SQL provenance.
        const canonical = Buffer.from((await readFile(entry.websitePath,"utf8")).replaceAll("\r\n","\n"));
        assert.equal(canonical.length,entry.websiteBytes,entry.websitePath);
        assert.equal(createHash("sha256").update(canonical).digest("hex"),entry.websiteSha256,entry.websitePath);
        if (!entry.representationException && entry.cpSha256) {
            assert.equal(entry.websiteSha256,entry.cpSha256); assert.equal(entry.websiteBytes,entry.cpBytes);
        }
    }
});

test("applied control-plane administrator migration retains exact merged SQL", async () => {
    const sql = await readFile("supabase/migrations/202609100001_control_plane_web_admin_principals.sql", "utf8");
    assert.equal(createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex"), "daa012cbf71ef62906493512a8f1ac13992e8f3a238b4af6b158fa6af2ab8c37");
});

test("pending control-plane monitor migration mirrors its source bytes", async () => {
    const sql = await readFile("supabase/migrations/202609100010_control_plane_monitor_indexes.sql", "utf8");
    assert.equal(createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex"), "57423dee19e5de20b381f3347e634dc8d9242f6491f5dd4ef34e784785b7bf59");
});
