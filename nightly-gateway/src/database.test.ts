import assert from "node:assert/strict";
import test from "node:test";
import { databaseForRequest, postgresSql } from "./database";

test("gateway SQL is schema-qualified and uses PostgreSQL parameters", () => {
    assert.equal(
        postgresSql(
            "SELECT expires_at FROM download_sessions WHERE token_hash = ? AND expires_at >= ?",
            2,
        ),
        "SELECT expires_at FROM \"nightly_gateway\".\"download_sessions\" WHERE token_hash = $1 AND expires_at >= $2",
    );
});

test("gateway SQL rejects parameter-count drift", () => {
    assert.throws(
        () => postgresSql("SELECT build_id FROM installer_pins WHERE token_hash = ?", 0),
        /gateway_database_parameter_mismatch/,
    );
});

test("an injected test database is used as-is", async () => {
    const injected = {
        prepare() { throw new Error("not used"); },
        async batch() { return []; },
    };
    assert.equal(await databaseForRequest({ DB: injected }), injected);
});

test("the gateway fails closed without Hyperdrive", async () => {
    await assert.rejects(
        databaseForRequest({}),
        /gateway_database_configuration_invalid/,
    );
});
