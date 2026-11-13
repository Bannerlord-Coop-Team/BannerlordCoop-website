import { readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { classifyLapseServers, lapseReportDiagnosticText } from "../supabase/functions/_shared/patreon-lapse-alert.ts";
import { parseLapseInventory } from "../supabase/functions/_shared/patreon-lapse-inventory.ts";

// Offline dry run only. The input is a captured/sanitized inventory plus the qualifying IDs from that same read.
async function main() {
    const { values } = parseArgs({ options: { input: { type: "string" } }, strict: true, allowPositionals: false });
    if (!values.input) throw new Error("Supply --input <reviewed-inventory.json>; no production connection or email is made");
    if ((await stat(values.input)).size > 2 * 1024 * 1024) throw new Error("Dry-run inventory is too large");
    const value = JSON.parse(await readFile(values.input, "utf8")) as Record<string, unknown>;
    if (value.version !== 1 || !Array.isArray(value.qualifyingPatreonUserIds)
        || value.qualifyingPatreonUserIds.length > 10000
        || !value.qualifyingPatreonUserIds.every(id => typeof id === "string" && /^\d{1,32}$/u.test(id))) {
        throw new Error("Invalid dry-run provenance envelope");
    }
    const report = classifyLapseServers(parseLapseInventory(value.inventory), new Set(value.qualifyingPatreonUserIds));
    process.stdout.write(`DRY RUN — no network, mail or lifecycle writes\n${lapseReportDiagnosticText(report)}\n`);
}
main().catch(() => { process.stderr.write("Lapse report dry run failed; check the input path and inventory shape\n"); process.exitCode = 1; });
