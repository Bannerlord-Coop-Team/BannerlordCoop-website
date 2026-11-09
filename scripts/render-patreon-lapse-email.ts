import { mkdir, readFile, writeFile } from "node:fs/promises";
import { classifyLapseServers, lapseReportHtml, lapseReportText } from "../supabase/functions/_shared/patreon-lapse-alert.ts";
import { parseLapseInventory } from "../supabase/functions/_shared/patreon-lapse-inventory.ts";

// Fixed, reviewed local fixture only: no credentials, network, lifecycle changes or mail delivery.
async function main() {
    const fixture = JSON.parse(await readFile(new URL("../tests/fixtures/patreon-lapse-links-v2.json", import.meta.url), "utf8"));
    const report = classifyLapseServers(parseLapseInventory(fixture.inventory), new Set<string>());
    const output = new URL("../docs/evidence/", import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL("patreon-lapse-links.html", output), lapseReportHtml(report) + "\n");
    await writeFile(new URL("patreon-lapse-links.txt", output), lapseReportText(report) + "\n");
    process.stdout.write("Rendered IDs-only sample: docs/evidence/patreon-lapse-links.{html,txt}; no network or email\n");
}
main().catch(() => { process.stderr.write("Offline email rendering failed\n"); process.exitCode = 1; });
