import { mkdir, readFile, writeFile } from "node:fs/promises";
import { classifyLapseServers, lapseReportHtml, lapseReportText } from "../supabase/functions/_shared/patreon-lapse-alert.ts";
import { parseLapseInventory } from "../supabase/functions/_shared/patreon-lapse-inventory.ts";

// Fixed, reviewed local fixture only: no credentials, network, lifecycle changes or mail delivery.
async function main() {
    const output = new URL("../docs/evidence/", import.meta.url);
    await mkdir(output, { recursive: true });
    for (const [fixtureName, sample] of [["patreon-lapse-links-v2", "patreon-lapse-links"], ["patreon-lapse-emails-v3", "patreon-lapse-emails"]]) {
        const fixture = JSON.parse(await readFile(new URL(`../tests/fixtures/${fixtureName}.json`, import.meta.url), "utf8"));
        const report = classifyLapseServers(parseLapseInventory(fixture.inventory), new Set<string>());
        await writeFile(new URL(`${sample}.html`, output), lapseReportHtml(report) + "\n");
        await writeFile(new URL(`${sample}.txt`, output), lapseReportText(report) + "\n");
    }
    process.stdout.write("Rendered synthetic link and email samples in docs/evidence; no network or mail delivery\n");
}
main().catch(() => { process.stderr.write("Offline email rendering failed\n"); process.exitCode = 1; });
