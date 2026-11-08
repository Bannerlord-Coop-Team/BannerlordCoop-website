import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findLapsedServers } from "../tests/fixtures/patreon-lapse-classifier-v6.mjs";
import { classifyLapseServers, lapseReportText } from "../supabase/functions/_shared/patreon-lapse-alert.ts";
import { parseLapseInventory } from "../supabase/functions/_shared/patreon-lapse-inventory.ts";

// Replay the frozen, sanitized candidate set through the captured classifier and the new report.
// This command never reads credentials, calls an API, changes state or sends SMTP.
const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/patreon-lapse-report-v1.json", import.meta.url), "utf8"));
const inventory = parseLapseInventory(fixture.inventory);
const patrons = new Set<string>(fixture.qualifyingPatreonUserIds);
const oldRows = findLapsedServers(inventory.servers.map(server => ({
    serverId: server.serverPrefix, accountId: server.accountPrefix, patreonUserId: server.patreonUserId,
})), patrons) as { serverId: string; accountId: string | null; reason: string }[];
const report = classifyLapseServers(inventory, patrons);
assert.equal(oldRows.length, 16);
assert.equal(report.rows.length, 16);
assert.deepEqual(new Set(oldRows.map(row => row.serverId)), new Set(report.rows.map(row => row.serverPrefix)));
const text = [
    "DRY RUN — frozen November 8 candidates; no network, email or lifecycle writes",
    "BEFORE (deployed version 6): 16 undifferentiated non-subscriber rows",
    ...oldRows.map(row => `- server ${row.serverId} / account ${row.accountId ?? "none"} | ${row.reason}`),
    "", "AFTER:", lapseReportText(report),
].join("\n");
assert.doesNotMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu);
process.stdout.write(`${text}\n`);
