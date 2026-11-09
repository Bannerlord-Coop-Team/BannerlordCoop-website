import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { parseCampaignMutation } from "../_shared/server-campaign-contract.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/war-sails-admission/v1.json", import.meta.url), "utf8"));
const token = "synthetic-owner-token-with-enough-characters";
const post = (body: unknown) => new Request("https://edge.test/my-servers", { method: "POST", headers: {
    "content-type": "application/json", authorization: `Bearer ${token}`, "x-request-id": fixture.requestId,
}, body: JSON.stringify(body) });

test("version 1 War Sails reset requests preserve their exact mode through the website producer", async () => {
    for (const reset of fixture.resets) {
        let calls = 0;
        const handler = createMyServersHandler({ allowedOrigins: ["https://website.test"], controlPlaneUrl: "https://cp.test",
            waitUntil: () => undefined, fetchImplementation: async (url, init) => {
                calls++;
                assert.equal(String(url), "https://cp.test/v1/user/control-plane");
                assert.equal(init?.method, "POST");
                assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
                const { action, ...input } = reset;
                assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId: fixture.requestId, operation: action, input });
                return Response.json({ version: 1, requestId: fixture.requestId, ok: true,
                    result: { outcome: "enqueued", jobId: fixture.requestId, action } });
            } });
        assert.deepEqual(parseCampaignMutation(reset), reset);
        assert.equal((await handler(post(reset))).status, 200);
        assert.equal(calls, 1);
    }
    assert.throws(() => parseCampaignMutation(fixture.invalidReset));
});

test("version 1 campaign refusals survive the website response consumer", async () => {
    for (const error of fixture.refusals) {
        const handler = createMyServersHandler({ allowedOrigins: ["https://website.test"], controlPlaneUrl: "https://cp.test",
            waitUntil: () => undefined, fetchImplementation: async () => Response.json({ version: 1,
                requestId: fixture.requestId, ok: false, error }, { status: 409 }) });
        const response = await handler(post(fixture.resets[1]));
        assert.equal(response.status, 409);
        assert.deepEqual((await response.json()).error, error);
    }
});
