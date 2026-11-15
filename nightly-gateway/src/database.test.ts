import assert from "node:assert/strict";
import test from "node:test";
import { databaseForRequest } from "./database";

test("the gateway fails closed without Hyperdrive", async () => {
    await assert.rejects(
        databaseForRequest({}),
        /gateway_database_configuration_invalid/,
    );
});

test("a D1-shaped binding is not mistaken for the gateway database", async () => {
    const d1Shaped = {
        prepare() { throw new Error("not used"); },
        async batch() { return []; },
    };
    await assert.rejects(
        databaseForRequest({ DB: d1Shaped as never }),
        /gateway_database_configuration_invalid/,
    );
});
