import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseArguments, publishEnvelope, UsageError } from "./hosting-regions-input";
import { hostingRegionCatalogPayload } from "../supabase/functions/_shared/hosting-regions";

/** Runs the script as a command through tsx, returning its exit status and output. */
function runScript(...args: string[]) {
    const script = fileURLToPath(new URL("./hosting-regions-input.ts", import.meta.url));
    const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("run as a command, the script prints the envelope or the usage line with a failing status", () => {
    const printed = runScript("7", "Add Japan");
    assert.equal(printed.status, 0, printed.stderr);
    assert.deepEqual(JSON.parse(printed.stdout).input, { expectedRevision: 7, regions: hostingRegionCatalogPayload(), reason: "Add Japan" });
    const rejected = runScript("7", "Add", "Japan");
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, "");
    assert.match(rejected.stderr, /^Usage: npx tsx scripts\/hosting-regions-input\.ts/u);
});

test("the envelope publishes exactly the website catalog against the given revision", () => {
    assert.deepEqual(publishEnvelope(["7", "Add Japan"], "11111111-1111-4111-8111-111111111111"), {
        version: 1,
        requestId: "11111111-1111-4111-8111-111111111111",
        operation: "set-hosting-regions",
        input: { expectedRevision: 7, regions: hostingRegionCatalogPayload(), reason: "Add Japan" },
    });
    assert.match(publishEnvelope(["1", "Seed"]).requestId, /^[0-9a-f-]{36}$/u);
});

test("arguments are rejected unless they are a decimal revision and a bounded quoted reason", () => {
    for (const args of [[], ["4"], ["4", "Add", "Japan"], ["0", "Reason"], ["1e1", "Reason"], ["0xb", "Reason"], [" 4", "Reason"], ["4", "ab"], ["4", "   "], ["4", " ab "], ["4", "x".repeat(1001)]]) {
        assert.throws(() => parseArguments(args), UsageError, JSON.stringify(args));
    }
    assert.deepEqual(parseArguments(["12", "  abc  "]), { expectedRevision: 12, reason: "abc" });
});
