import assert from "node:assert/strict";
import test from "node:test";
import { databaseForRequest, postgresSql } from "./database";

test("gateway SQL is schema-qualified and uses PostgreSQL parameters", () => {
    assert.equal(
        postgresSql(
            "SELECT id FROM device_sessions WHERE device_secret_hash = ? AND expires_at >= ?",
            2,
        ),
        "SELECT id FROM \"nightly_gateway\".\"device_sessions\" WHERE device_secret_hash = $1 AND expires_at >= $2",
    );
});

test("INSERT OR IGNORE becomes a conflict-safe PostgreSQL insert", () => {
    assert.equal(
        postgresSql(
            "INSERT OR IGNORE INTO sponsorships (supporter_discord_user_id, sponsored_discord_user_id) VALUES (?, ?)",
            2,
        ),
        "INSERT INTO \"nightly_gateway\".\"sponsorships\" (supporter_discord_user_id, sponsored_discord_user_id) VALUES ($1, $2)\nON CONFLICT DO NOTHING",
    );
});

test("gateway SQL rejects parameter-count drift", () => {
    assert.throws(
        () => postgresSql("SELECT id FROM device_sessions WHERE id = ?", 0),
        /gateway_database_parameter_mismatch/,
    );
});

test("the bridge defaults to the legacy D1 binding until cutover", async () => {
    const legacy = {
        prepare() { throw new Error("not used"); },
        async batch() { return []; },
    };
    assert.equal(await databaseForRequest({ LEGACY_DB: legacy }), legacy);
    assert.equal(await databaseForRequest({ LEGACY_DB: legacy, DATABASE_BACKEND: "legacy-d1" }), legacy);
});

test("unknown database backends fail closed", async () => {
    await assert.rejects(
        databaseForRequest({ DATABASE_BACKEND: "sqlite" }),
        /gateway_database_backend_invalid/,
    );
});
