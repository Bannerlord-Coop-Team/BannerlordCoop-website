import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSafeInt8, postgresGatewayDatabase, postgresSql } from "../_shared/nightly/database.ts";
import { applyMigration, createGatewayDatabase, NOW, SPONSOR } from "./test-harness.ts";

const WORKER_GRANT_UPSERT = `
    INSERT INTO supporter_grants (supporter_discord_user_id, encrypted_refresh_token, token_nonce, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(supporter_discord_user_id) DO UPDATE SET
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_nonce = excluded.token_nonce,
      updated_at = excluded.updated_at
`;

test("gateway SQL is schema-qualified and uses PostgreSQL parameters", () => {
    assert.equal(
        postgresSql("SELECT id FROM device_sessions WHERE device_secret_hash = ? AND expires_at >= ?", 2),
        "SELECT id FROM \"nightly_gateway\".\"device_sessions\" WHERE device_secret_hash = $1 AND expires_at >= $2",
    );
    assert.equal(
        postgresSql("DELETE FROM download_sessions WHERE token_hash = ?", 1),
        "DELETE FROM \"nightly_gateway\".\"download_sessions\" WHERE token_hash = $1",
    );
});

test("INSERT OR IGNORE becomes a conflict-safe PostgreSQL insert", () => {
    assert.equal(
        postgresSql("INSERT OR IGNORE INTO sponsorships (supporter_discord_user_id, sponsored_discord_user_id) VALUES (?, ?)", 2),
        "INSERT INTO \"nightly_gateway\".\"sponsorships\" (supporter_discord_user_id, sponsored_discord_user_id) VALUES ($1, $2)\nON CONFLICT DO NOTHING",
    );
});

test("gateway SQL rejects parameter-count drift", () => {
    assert.throws(() => postgresSql("SELECT id FROM device_sessions WHERE id = ?", 0), /gateway_database_parameter_mismatch/);
});

test("INT8 columns parse as safe JavaScript numbers only", () => {
    assert.equal(parseSafeInt8("1800000000"), 1_800_000_000);
    assert.throws(() => parseSafeInt8("9223372036854775807"), /postgres_integer_out_of_range/);
});

test("batches commit together and roll back together", async () => {
    const pg = await createGatewayDatabase();
    try {
        const database = postgresGatewayDatabase(pg);
        await database.batch([
            database.prepare("INSERT INTO supporter_grants (supporter_discord_user_id, updated_at) VALUES (?, ?)").bind(SPONSOR, NOW),
        ]);
        await assert.rejects(database.batch([
            database.prepare("UPDATE supporter_grants SET updated_at = ? WHERE supporter_discord_user_id = ?").bind(NOW + 1, SPONSOR),
            database.prepare("INSERT INTO supporter_grants (supporter_discord_user_id, updated_at) VALUES (?, ?)").bind(SPONSOR, NOW),
        ]));
        assert.deepEqual(await database.prepare("SELECT updated_at FROM supporter_grants").all(), { results: [{ updated_at: NOW }] });
        await assert.rejects(database.batch([]), /gateway_database_batch_invalid/);
    } finally {
        await pg.close();
    }
});

test("the refresh-token migration clears stored tokens and keeps the running Worker's upsert valid", async () => {
    const pg = await createGatewayDatabase(2);
    try {
        const database = postgresGatewayDatabase(pg);
        await database.prepare(WORKER_GRANT_UPSERT).bind(SPONSOR, "c".repeat(64), "n".repeat(16), NOW).run();
        await applyMigration(pg, "20261115090000_nightly_gateway_retire_refresh_tokens");
        const select = "SELECT encrypted_refresh_token, token_nonce FROM supporter_grants WHERE supporter_discord_user_id = ?";
        assert.deepEqual(await database.prepare(select).bind(SPONSOR).first(), { encrypted_refresh_token: null, token_nonce: null });

        await database.prepare(WORKER_GRANT_UPSERT).bind(SPONSOR, "c".repeat(64), "n".repeat(16), NOW + 1).run();
        assert.deepEqual(await database.prepare(select).bind(SPONSOR).first(), { encrypted_refresh_token: "c".repeat(64), token_nonce: "n".repeat(16) });

        await assert.rejects(database.prepare(WORKER_GRANT_UPSERT).bind(SPONSOR, "short", "n".repeat(16), NOW).run(), /supporter_grants_refresh_token/);
        await assert.rejects(database.prepare(WORKER_GRANT_UPSERT).bind(SPONSOR, "c".repeat(64), null, NOW).run(), /supporter_grants_refresh_token_pair/);
    } finally {
        await pg.close();
    }
});
