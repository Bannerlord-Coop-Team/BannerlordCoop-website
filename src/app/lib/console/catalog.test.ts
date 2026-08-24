import assert from "node:assert/strict";
import test from "node:test";
import {
    parseConsoleServerCatalog,
    type LiveConsoleServer,
} from "./catalog";

const fallback: readonly LiveConsoleServer[] = [{
    id: "fallback-server",
    name: "Fallback",
    address: "203.0.113.10:4200",
    nodeId: "node-one",
    provider: "External VPS",
}];

test("uses the fallback console catalog when no override is configured", () => {
    assert.equal(parseConsoleServerCatalog(undefined, fallback), fallback);
});

test("parses multiple servers assigned to the same VPS node", () => {
    const catalog = parseConsoleServerCatalog(JSON.stringify([
        {
            id: "server-one",
            name: "Server One",
            address: "203.0.113.10:4200",
            nodeId: "node-one",
            provider: "External VPS",
        },
        {
            id: "server-two",
            name: "Server Two",
            address: "203.0.113.10:4201",
            nodeId: "node-one",
            provider: "External VPS",
        },
    ]), fallback);

    assert.equal(catalog.length, 2);
    assert.equal(catalog[0].nodeId, catalog[1].nodeId);
    assert.notEqual(catalog[0].id, catalog[1].id);
});

test("rejects ambiguous or unsupported catalog entries", () => {
    assert.throws(
        () => parseConsoleServerCatalog(JSON.stringify([
            { ...fallback[0] },
            { ...fallback[0] },
        ]), fallback),
        /duplicate server ID/,
    );
    assert.throws(
        () => parseConsoleServerCatalog(JSON.stringify([
            { ...fallback[0], unexpected: true },
        ]), fallback),
        /unsupported key unexpected/,
    );
    assert.throws(
        () => parseConsoleServerCatalog(JSON.stringify([
            { ...fallback[0], id: "../unsafe" },
        ]), fallback),
        /id is invalid/,
    );
});
