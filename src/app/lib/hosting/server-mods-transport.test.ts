import assert from "node:assert/strict";
import test from "node:test";
import { MODS_REFRESH_SESSION_HEADER } from "./server-mods";
import { createServerModsHttpTransport } from "./server-mods-transport";

const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const LIST = { route: "list", body: { serverId: SERVER_ID } } as const;

/** Builds the transport over a fetch that answers every call with `reply` and records each request. */
function transport(reply: () => Response) {
    const requests: { url: string; headers: Headers }[] = [];
    const http = createServerModsHttpTransport(async (input, init) => {
        requests.push({ url: String(input), headers: new Headers(init?.headers) });
        return reply();
    });
    return { http, requests };
}

test("retries a reply without the route envelope only for gateway, deadline and rate statuses", async () => {
    const cases: [Response, { code: string; retryable: boolean }][] = [
        [new Response("Not found.", { status: 404 }), { code: "invalid_response", retryable: false }],
        [new Response(null, { status: 405 }), { code: "invalid_response", retryable: false }],
        [new Response("<html>too large</html>", { status: 413 }), { code: "invalid_response", retryable: false }],
        [Response.json({ message: "nope" }, { status: 400 }), { code: "invalid_response", retryable: false }],
        [new Response("<html>bad gateway</html>", { status: 502 }), { code: "server_api_unavailable", retryable: true }],
        [new Response("", { status: 408 }), { code: "server_api_unavailable", retryable: true }],
        [new Response("slow down", { status: 429 }), { code: "rate_limited", retryable: true }],
        [Response.json({ unexpected: true }), { code: "invalid_response", retryable: true }],
    ];
    for (const [response, expected] of cases) {
        const { http } = transport(() => response);
        assert.deepEqual(await http.send(SERVER_ID, LIST, { refreshSession: false }), { ok: false, error: { ...expected, modId: null } }, `status ${response.status}`);
    }
});

test("passes a typed refusal through and treats a malformed one as no envelope", async () => {
    const refusal = { ok: false, error: { code: "mod_order_invalid", retryable: false, modId: "Beta" } };
    assert.deepEqual(await transport(() => Response.json(refusal, { status: 400 })).http.send(SERVER_ID, LIST, { refreshSession: false }), refusal);
    const malformed = { ok: false, error: { code: "mod_order_invalid", retryable: false, modId: "../Beta" } };
    assert.deepEqual(await transport(() => Response.json(malformed, { status: 400 })).http.send(SERVER_ID, LIST, { refreshSession: false }),
        { ok: false, error: { code: "invalid_response", retryable: false, modId: null } });
});

test("asks the route to refresh the session only when told to, and reports network loss as retryable", async () => {
    const { http, requests } = transport(() => new Response("", { status: 503 }));
    await http.send(SERVER_ID, LIST, { refreshSession: false });
    await http.send(SERVER_ID, LIST, { refreshSession: true });
    assert.deepEqual(requests.map(request => request.headers.get(MODS_REFRESH_SESSION_HEADER)), [null, "1"]);
    assert.equal(requests[0].url, `/api/servers/${SERVER_ID}/mods?route=list`);
    const offline = createServerModsHttpTransport(async () => { throw new TypeError("Failed to fetch"); });
    assert.deepEqual(await offline.send(SERVER_ID, LIST, { refreshSession: false }), { ok: false, error: { code: "network_unavailable", retryable: true, modId: null } });
});
