import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers";
import { MAXIMUM_CONSOLE_OUTPUT_BYTES, parseConsoleSubmission, parseConsoleResult } from "../../../../supabase/functions/_shared/server-console-contract";
import { submitMyServerConsoleCommand, getMyServerConsoleResult, acknowledgeMyServerConsoleResult } from "./server-console";

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const input = { serverId, command: "coop.help", expectedUpdatedAt: "2026-09-20T12:00:00.000Z" };
const reference = { serverId, jobId, commandRequestId: requestId };
const success = { status: "succeeded", output: "<script>not HTML</script>", outputTruncated: false, outputWithheld: false, completedAt: input.expectedUpdatedAt };

test("normalizes commands and rejects separators, non-coop commands, extra fields and oversized input/output", () => {
    assert.equal(parseConsoleSubmission({ ...input, command: "  ｃｏｏｐ.help  " }).command, "coop.help");
    for (const command of ["save", "coop.help; stop", "coop.help\ncoop.help", "coop.help\u2028foo", `coop.${"a".repeat(4092)}`]) {
        assert.throws(() => parseConsoleSubmission({ ...input, command }));
    }
    assert.throws(() => parseConsoleSubmission({ ...input, admin: true }));
    assert.deepEqual(parseConsoleResult(success), success);
    assert.throws(() => parseConsoleResult({ ...success, output: "a".repeat(MAXIMUM_CONSOLE_OUTPUT_BYTES + 1) }));
    assert.throws(() => parseConsoleResult({ ...success, outputTruncated: "false" }));
});

test("commands, result and acknowledgement cross Edge with exact request binding and isolated output limits", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key-long-enough";
    const seen: { operation: string; requestId: string; input: unknown }[] = [];
    const handler = createMyServersHandler({ allowedOrigins: ["https://bannerlordcoop.com"], controlPlaneUrl: "https://cp.example", fetchImplementation: async (url, init) => {
        assert.equal(String(url), "https://cp.example/v1/user/control-plane");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-access-token-long-enough");
        const body = JSON.parse(String(init?.body));
        seen.push(body);
        const result = body.operation === "console-command" ? { outcome: "enqueued", jobId }
            : body.operation === "console-command-result" ? { ...success, output: "x".repeat(100_000) } : { acknowledged: true };
        return Response.json({ version: 1, requestId: body.requestId, ok: true, result });
    } });
    globalThis.fetch = (url, init) => handler(new Request(url, init));
    try {
        await submitMyServerConsoleCommand("test-access-token-long-enough", requestId, input);
        const result = await getMyServerConsoleResult("test-access-token-long-enough", reference);
        assert.equal(result.status, "succeeded");
        await acknowledgeMyServerConsoleResult("test-access-token-long-enough", reference);
        assert.deepEqual(seen.map(request => request.operation), ["console-command", "console-command-result", "acknowledge-console-command"]);
        assert.equal(seen[0].requestId, requestId);
        assert.deepEqual(seen[0].input, input);
        assert.deepEqual(seen[1].input, reference);
        assert.deepEqual(seen[2].input, reference);
        assert.notEqual(seen[1].requestId, requestId);
        assert.notEqual(seen[2].requestId, seen[1].requestId);
        const noId = await handler(new Request("https://supabase.example/functions/v1/my-servers", { method: "POST", headers: { authorization: "Bearer test-access-token-long-enough", "content-type": "application/json" }, body: JSON.stringify({ action: "console-command", ...input }) }));
        assert.equal(noId.status, 400);
        assert.equal(seen.length, 3);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
        if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
    }
});
