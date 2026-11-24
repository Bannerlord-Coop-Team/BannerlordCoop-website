import assert from "node:assert/strict";
import test from "node:test";
import { openHyperdriveDatabase } from "./database";

test("the gateway fails closed without Hyperdrive", async () => {
    await assert.rejects(
        openHyperdriveDatabase({}),
        /gateway_database_configuration_invalid/,
    );
});
