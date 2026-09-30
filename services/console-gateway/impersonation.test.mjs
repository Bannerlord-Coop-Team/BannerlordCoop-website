import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const target = "22222222-2222-4222-8222-222222222222";
const actor = "11111111-1111-4111-8111-111111111111";
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (!predicate()) { assert.ok(Date.now() < deadline, "Fixture deadline exceeded"); await pause(); }
}
async function connect(url, options) {
    const socket = new WebSocket(url, options), messages = [];
    socket.on("message", data => messages.push(JSON.parse(data.toString())));
    await once(socket, "open");
    return { socket, messages, async take(type) {
        await waitFor(() => messages.some(message => message.type === type));
        return messages.splice(messages.findIndex(message => message.type === type), 1)[0];
    } };
}
test("gateway forwards target console input and lifecycle actions, then closes an ended impersonation before any further write", { timeout: 20_000 }, async () => {
    let active = true;
    const checks = [];
    const auth = http.createServer(async (request, response) => {
        assert.equal(request.headers.authorization, "Bearer native-target-fixture");
        response.setHeader("content-type", "application/json");
        if (request.url === "/auth/v1/user") {
            response.end(JSON.stringify({ id: target, app_metadata: { role: "User", live_console_owner_server_ids: ["fixture-server"] }, identities: [] }));
        } else {
            assert.equal(request.url, "/rest/v1/rpc/website_session_context");
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            checks.push(JSON.parse(Buffer.concat(chunks).toString()).p_action);
            response.statusCode = active ? 200 : 403;
            response.end(JSON.stringify(active ? { impersonationId: "33333333-3333-4333-8333-333333333333", actorId: actor, targetId: target, expiresAt: "2099-01-01T00:00:00Z" } : {}));
        }
    });
    auth.listen(0, "127.0.0.1"); await once(auth, "listening");
    const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const gateway = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { env: {
        PATH: process.env.PATH, PORT: String(port), CONSOLE_NODE_TOKEN: "isolated-console-node-key-with-enough-characters",
        CONSOLE_ALLOWED_ORIGINS: "http://127.0.0.1", CONSOLE_SERVER_NODES: JSON.stringify({ "fixture-server": "fixture-node" }),
        SUPABASE_URL: `http://127.0.0.1:${auth.address().port}`, SUPABASE_PUBLISHABLE_KEY: "isolated-publishable-fixture-key",
    }, stdio: "ignore" });
    let node, browser;
    try {
        const deadline = Date.now() + 5000;
        for (;;) {
            assert.equal(gateway.exitCode, null, "Fixture gateway exited");
            try { if ((await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(200) })).ok) break; } catch { /* bounded startup */ }
            assert.ok(Date.now() < deadline); await pause();
        }
        node = await connect(`ws://127.0.0.1:${port}/v1/node`, { headers: { authorization: "Bearer isolated-console-node-key-with-enough-characters" } });
        node.socket.send(JSON.stringify({ type: "register", nodeId: "fixture-node", servers: ["fixture-server"] })); await node.take("registered");
        browser = await connect(`ws://127.0.0.1:${port}/v1/browser`, { origin: "http://127.0.0.1" });
        browser.socket.send(JSON.stringify({ type: "authenticate", accessToken: "native-target-fixture", serverId: "fixture-server" }));
        await browser.take("ready"); const attached = await node.take("attach");
        node.socket.send(JSON.stringify({ type: "attached", sessionId: attached.sessionId, inputEnabled: true })); await browser.take("attached");
        browser.socket.send(JSON.stringify({ type: "input", data: "help\n" }));
        assert.equal((await node.take("input")).data, "help\n");
        browser.socket.send(JSON.stringify({ type: "operation", operation: "stop" }));
        const operation = await node.take("operation");
        assert.equal(operation.operation, "stop");
        node.socket.send(JSON.stringify({ ...operation, type: "operationResult", ok: true }));
        await browser.take("operationResult");
        active = false;
        const closed = once(browser.socket, "close");
        browser.socket.send(JSON.stringify({ type: "input", data: "must-not-forward\n" }));
        await closed; await node.take("close");
        assert.equal(node.messages.some(message => message.type === "input"), false);
        active = true;
        browser = await connect(`ws://127.0.0.1:${port}/v1/browser`, { origin: "http://127.0.0.1" });
        browser.socket.send(JSON.stringify({ type: "authenticate", accessToken: "native-target-fixture", serverId: "fixture-server" }));
        await browser.take("ready"); await node.take("attach");
        active = false;
        await once(browser.socket, "close"); await node.take("close");
        assert.ok(checks.includes("console.input") && checks.includes("console.operation") && checks.includes("console.heartbeat"));
    } finally {
        browser?.socket.terminate(); node?.socket.terminate();
        if (gateway.exitCode === null && gateway.signalCode === null) { const exited = once(gateway, "exit"); gateway.kill(); await exited; }
        auth.closeAllConnections(); await new Promise(resolve => auth.close(resolve));
    }
});
