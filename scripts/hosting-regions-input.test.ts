import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments, publishEnvelope, UsageError } from "./hosting-regions-input";
import { hostingRegionCatalogPayload } from "../supabase/functions/_shared/hosting-regions";

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
    for (const args of [[], ["4"], ["4", "Add", "Japan"], ["0", "Reason"], ["1e1", "Reason"], ["0xb", "Reason"], [" 4", "Reason"], ["4", "ab"], ["4", "x".repeat(1001)]]) {
        assert.throws(() => parseArguments(args), UsageError, JSON.stringify(args));
    }
    assert.deepEqual(parseArguments(["12", "abc"]), { expectedRevision: 12, reason: "abc" });
});
