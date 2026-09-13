import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedJson, type JsonReadDiagnostics } from "./membership.ts";

for (const [name, response, max, phase, contentType] of [
    ["JSON:API content type", () => new Response('{"secret":"private-account"}', { headers: { "Content-Type": "application/vnd.api+json; charset=utf-8" } }), 100, "content_type", "application/vnd.api+json"],
    ["unrecognized header", () => new Response("private-account", { headers: { "Content-Type": "private-secret-type" } }), 100, "content_type", "other"],
    ["missing body", () => new Response(null, { headers: { "Content-Type": "application/json" } }), 100, "missing_body", "application/json"],
    ["size limit", () => Response.json({ secret: "private-account" }), 1, "body_size", "application/json"],
    ["invalid UTF-8", () => new Response(new Uint8Array([255]), { headers: { "Content-Type": "application/json" } }), 100, "utf8_decode", "application/json"],
    ["invalid JSON", () => new Response("private-secret-body", { headers: { "Content-Type": "application/json" } }), 100, "json_parse", "application/json"],
] as const) {
    test(`bounded JSON diagnostics identify ${name} without disclosing content`, async () => {
        const diagnostics: JsonReadDiagnostics[] = [];
        await assert.rejects(boundedJson(response(), max, details => diagnostics.push(details)));
        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].phase, phase);
        assert.equal(diagnostics[0].contentType, contentType);
        assert.equal(diagnostics[0].maxBytes, max);
        assert.equal(diagnostics[0].status, 200);
        assert.ok(diagnostics[0].elapsedMs >= 0);
        assert.ok(diagnostics[0].bytesRead >= 0);
        assert.deepEqual(Object.keys(diagnostics[0]).sort(), ["bytesRead", "contentType", "elapsedMs", "maxBytes", "phase", "status"]);
        assert.ok(!JSON.stringify(diagnostics).includes("private-"));
    });
}
test("successful JSON reads do not emit diagnostics", async () => {
    assert.deepEqual(await boundedJson(Response.json({ ok: true }), 100, () => assert.fail("Unexpected diagnostic")), { ok: true });
});
test("diagnostic observer failure does not replace the original failure", async () => {
    await assert.rejects(boundedJson(new Response("not JSON"), 100, () => { throw new Error("observer failure"); }), /Invalid JSON response/);
});
test("body timeouts are classified without reading or logging body content", async () => {
    const diagnostics: JsonReadDiagnostics[] = [];
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); } });
    await assert.rejects(boundedJson(new Response(body, { headers: { "Content-Type": "application/json" } }), 100, details => diagnostics.push(details)), /Body deadline exceeded/);
    assert.equal(diagnostics[0].phase, "body_timeout");
});

test("JSON:API opt-in accepts exact media type with case and parameters", async () => {
    for (const contentType of ["application/vnd.api+json", "Application/Vnd.Api+Json; charset=utf-8"]) {
        const response = Response.json({ data: { type: "user", id: "123" } }, { headers: { "Content-Type": contentType } });
        assert.deepEqual(await boundedJson(response, 100, undefined, { allowJsonApi: true }), { data: { type: "user", id: "123" } });
    }
});
test("JSON:API opt-in still rejects HTML, lookalike types, bad JSON, invalid UTF-8 and oversized bodies", async () => {
    for (const contentType of ["text/html", "application/vnd.api+json-invalid", "application/problem+json"]) {
        await assert.rejects(boundedJson(Response.json({}, { headers: { "Content-Type": contentType } }), 100, undefined, { allowJsonApi: true }), /Invalid JSON response/);
    }
    const headers = { "Content-Type": "application/vnd.api+json" };
    await assert.rejects(boundedJson(new Response("not JSON", { headers }), 100, undefined, { allowJsonApi: true }), SyntaxError);
    await assert.rejects(boundedJson(new Response(new Uint8Array([255]), { headers }), 100, undefined, { allowJsonApi: true }), TypeError);
    await assert.rejects(boundedJson(Response.json({ data: "oversized" }, { headers }), 1, undefined, { allowJsonApi: true }), /Response too large/);
});
