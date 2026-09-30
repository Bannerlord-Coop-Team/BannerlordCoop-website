import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { getLiveConsoleServer, listLiveConsoleServers } from "./servers";

let originalCatalog: string | undefined;

// Isolate each catalog case from the developer's configured environment.
beforeEach(() => {
    originalCatalog = process.env.CONSOLE_SERVER_CATALOG;
    delete process.env.CONSOLE_SERVER_CATALOG;
});

// Restore the environment after each routing case.
afterEach(() => {
    if (originalCatalog === undefined) {
        delete process.env.CONSOLE_SERVER_CATALOG;
        return;
    }
    process.env.CONSOLE_SERVER_CATALOG = originalCatalog;
});

// Discovery matrix: no explicit catalog means no legacy alias; explicit external entries stay available.
test("does not synthesize the old external server when no catalog is configured", () => {
    assert.deepEqual(listLiveConsoleServers(), []);
    assert.equal(getLiveConsoleServer("bannerlord-live-15-204-120-17"), null);
});

test("preserves explicitly configured external servers and their verified managed mapping", () => {
    const server = {
        id: "external-campaign",
        name: "External campaign",
        address: "203.0.113.10",
        nodeId: "node-one",
        provider: "External VPS",
        managedServerId: "abcdef12-1234-4123-8123-123456789abc",
    };
    process.env.CONSOLE_SERVER_CATALOG = JSON.stringify([server]);
    assert.deepEqual(listLiveConsoleServers(), [server]);
    assert.deepEqual(getLiveConsoleServer(server.id), server);
});
