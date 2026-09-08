import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("membership shared upgrade inventory pins own history and exact new CP Git mirrors without historical rewrites", async () => {
    const inventory = JSON.parse(await readFile("docs/membership-migration-inventory.json", "utf8"));
    const expected = inventory.migrations as { version: string; websitePath: string; websiteSha256: string; websiteBytes: number; cpSha256?: string; cpBytes?: number; representationException: boolean }[];
    assert.equal(inventory.cpSourceHead, "4160f7bda49c6dd7dab57b912811c793dec90ac3");
    assert.equal(inventory.websiteBaselineHead, "ba0d34cb9023360bb13632112bc4509484c096b6");
    assert.equal(expected.length,25); assert.equal(new Set(expected.map(e=>e.version)).size,25);
    assert.equal(expected.filter(e=>!e.representationException).length,15);
    assert.equal(inventory.integratedWebsiteMainHead,"f012d9412d98a1e8f50bcc3887c655a813959500");
    for (const version of ["20260907220000","20260907230000"]) {
        const entry=inventory.migrations.find((e:{version:string})=>e.version===version);
        assert.deepEqual(entry.provenance,{websiteHead:"f012d9412d98a1e8f50bcc3887c655a813959500",pullRequest:104});
        assert.equal(entry.releaseClassification,"required already-applied external history; NEVER replay");
    }
    assert.deepEqual((await readdir("supabase/migrations")).filter(f=>f.endsWith(".sql")).sort(),expected.map(e=>e.websitePath.split("/").at(-1)).sort());
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
