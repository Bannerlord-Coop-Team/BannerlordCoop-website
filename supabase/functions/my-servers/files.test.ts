import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION } from "../_shared/managed-server-configuration.ts";
import { parseOwnerFileMutation, parseOwnerFileDownload } from "../_shared/server-file-contract.ts";
const requestId = "aaaaaaaa-1111-4111-8111-111111111111";
const input = { action: "import-config", serverId: requestId, expectedUpdatedAt: "2026-09-13T00:00:00.000Z", managedConfig: DEFAULT_MANAGED_SERVER_CONFIGURATION };
const result = { kind: "configuration", outcome: "updated", updatedAt: "2026-09-13T00:00:01.000Z" };
const token = "original-token-with-enough-characters";
function request(body: unknown, auth = true, id = true) { return new Request("https://edge.test/my-servers?resource=file-transfer", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}), ...(id ? { "x-request-id": requestId } : {}) }, body: JSON.stringify(body) }); }
function handler(fetchImplementation: typeof fetch) { return createMyServersHandler({ allowedOrigins: ["https://website.test"], controlPlaneUrl: "https://cp.test", fetchImplementation }); }

test("configuration transfer preserves verified bearer, exact input and durable request ID", async () => {
    const response = await handler(async (url, init) => {
        assert.equal(String(url), "https://cp.test/v1/user/files");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
        assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId, operation: "file-transfer", input });
        return Response.json({ version: 1, requestId, ok: true, result });
    })(request(input));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("rejects forged privileges, secret config fields, unsafe file pairs and absent auth/correlation before forwarding", async () => {
    let calls = 0;
    const run = handler(async () => { calls++; throw Error("Unexpected fetch"); });
    for (const req of [request(input, false), request(input, true, false), request({ ...input, role: "owner" }), request({ ...input, managedConfig: { ...input.managedConfig, password: "secret" } })]) assert.ok((await run(req)).status >= 400);
    assert.equal(calls, 0);
    const save = { action: "import-save", serverId: requestId, expectedUpdatedAt: input.expectedUpdatedAt, displayName: "Campaign", files: [{ basename: "Campaign.sav", base64: "YQ==" }, { basename: "Campaign.json", base64: "e30=" }] };
    assert.deepEqual(parseOwnerFileMutation(save), save);
    for (const name of ["../Campaign.sav", "Campaign.zip", "Other.sav", "Campaign\\file.sav"]) assert.throws(() => parseOwnerFileMutation({ ...save, files: [{ ...save.files[0], basename: name }, save.files[1]] }));
    assert.throws(() => parseOwnerFileMutation({ ...save, files: [{ ...save.files[0], base64: "a" }, save.files[1]] }));
    assert.throws(() => parseOwnerFileMutation({ ...save, files: [{ ...save.files[0], base64: "A".repeat(28 * 1024 * 1024) }, save.files[1]] }));
});

test("download response has its own bounded allowance and retains binary data larger than normal mutation results", async () => {
    const base64 = Buffer.alloc(100_000, 7).toString("base64");
    const download = { kind: "file", fileName: "Campaign.zip", byteSize: 100_000, base64 };
    const response = await handler(async (_url, init) => {
        const upstream = JSON.parse(String(init?.body));
        assert.equal(upstream.operation, "download-save-export");
        return Response.json({ version: 1, requestId: upstream.requestId, ok: true, result: download });
    })(new Request(`https://edge.test/my-servers?resource=download-save-export&serverId=${requestId}&transferRequestId=${requestId}`, { headers: { authorization: `Bearer ${token}` } }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, download);
    assert.throws(() => parseOwnerFileDownload({ ...download, fileName: "../secret" }));
    assert.throws(() => parseOwnerFileDownload({ ...download, byteSize: 1 }));
    assert.throws(() => parseOwnerFileDownload({ kind: "link", url: "javascript:alert(1)", byteSize: 100, expiresAt: input.expectedUpdatedAt }));
});

test("correlation and downstream validation failures remain unconfirmed, never successful", async () => {
    for (const response of [{ version: 1, requestId: "bbbbbbbb-1111-4111-8111-111111111111", ok: true, result }, { version: 1, requestId, ok: true, result: { ...result, password: "forbidden" } }]) {
        assert.equal((await handler(async () => Response.json(response))(request(input))).status, 502);
    }
});
