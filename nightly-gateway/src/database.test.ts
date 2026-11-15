import assert from "node:assert/strict";
import test from "node:test";
import { openHyperdriveDatabase, type GatewayDatabase } from "./database";

test("the gateway fails closed without Hyperdrive", async () => {
    await assert.rejects(
        openHyperdriveDatabase({}),
        /gateway_database_configuration_invalid/,
    );
});

test("a stray DB binding never replaces Hyperdrive", async () => {
    const stray: GatewayDatabase = {
        async query() { throw new Error("a DB binding must never be used"); },
        async transaction() { throw new Error("a DB binding must never be used"); },
    };
    await assert.rejects(
        openHyperdriveDatabase({ DB: stray } as never),
        /gateway_database_configuration_invalid/,
    );
});
