import assert from "node:assert/strict";
import test from "node:test";
import { createNightlyClient } from "./client";
import { loggingFetch, reportConfigInvalid } from "./diagnostics";

const FUNCTION_URL = "https://project.supabase.co/functions/v1/nightly-gateway";
const config = { functionUrl: FUNCTION_URL, websiteKey: "website-key-value" };

test("a missing or invalid config is logged as one structured event without values", () => {
    const entries: Record<string, string>[] = [];
    reportConfigInvalid((entry) => entries.push(entry));
    assert.deepEqual(entries, [{ event: "nightly_config_invalid" }]);
});

test("an unreachable Edge Function is logged with the route and error name, never the key or message", async () => {
    const entries: Record<string, string>[] = [];
    const failing = loggingFetch(async () => { throw new DOMException(`timed out ${config.websiteKey}`, "TimeoutError"); }, FUNCTION_URL, (entry) => entries.push(entry));
    const result = await createNightlyClient(config, failing).sponsorPortal("A".repeat(43));
    assert.deepEqual(result, { ok: false, status: 0, code: "unavailable" });
    assert.deepEqual(entries, [{ event: "nightly_function_unreachable", path: "/sponsor/portal", error: "TimeoutError" }]);
    assert.ok(!JSON.stringify(entries).includes(config.websiteKey));
});

test("a reachable Edge Function logs nothing, even on an error status", async () => {
    const entries: Record<string, string>[] = [];
    const answering = loggingFetch(async () => new Response(JSON.stringify({ error: "internal_error" }), { status: 500 }), FUNCTION_URL, (entry) => entries.push(entry));
    const result = await createNightlyClient(config, answering).startSponsorOAuth();
    assert.deepEqual(result, { ok: false, status: 500, code: "internal_error" });
    assert.deepEqual(entries, []);
});
