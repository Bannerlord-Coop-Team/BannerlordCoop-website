import assert from "node:assert/strict";
import { test } from "node:test";
import {
    firstRow,
    isUniqueViolation,
    parseSafeInt8,
    postgresGatewayDatabase,
    type PostgresClient,
} from "../_shared/nightly/database.ts";
import { applyMigration, createGatewayDatabase, NOW, SPONSOR } from "./test-harness.ts";

const WORKER_GRANT_UPSERT = `
    INSERT INTO nightly_gateway.supporter_grants (supporter_discord_user_id, encrypted_refresh_token, token_nonce, updated_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (supporter_discord_user_id) DO UPDATE SET
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_nonce = excluded.token_nonce,
      updated_at = excluded.updated_at
`;
const INSERT_GRANT = "INSERT INTO nightly_gateway.supporter_grants (supporter_discord_user_id, updated_at) VALUES ($1, $2)";

test("INT8 columns parse as safe JavaScript numbers only", () => {
    assert.equal(parseSafeInt8("1800000000"), 1_800_000_000);
    assert.throws(() => parseSafeInt8("9223372036854775807"), /postgres_integer_out_of_range/);
});

test("queries return typed rows and the affected-row count", async () => {
    const pg = await createGatewayDatabase();
    try {
        const database = postgresGatewayDatabase(pg);
        assert.equal((await database.query(INSERT_GRANT, [SPONSOR, NOW])).rowCount, 1);
        const selected = await database.query<{ updated_at: number }>(
            "SELECT updated_at FROM nightly_gateway.supporter_grants WHERE supporter_discord_user_id = $1",
            [SPONSOR],
        );
        assert.deepEqual(firstRow(selected), { updated_at: NOW });
        const missing = await database.query("SELECT 1 FROM nightly_gateway.supporter_grants WHERE supporter_discord_user_id = $1", ["1"]);
        assert.equal(firstRow(missing), null);
        const ignored = await database.query(`${INSERT_GRANT} ON CONFLICT DO NOTHING`, [SPONSOR, NOW]);
        assert.equal(ignored.rowCount, 0);
        await assert.rejects(database.query(INSERT_GRANT, [SPONSOR, NOW]), (error) => isUniqueViolation(error));
    } finally {
        await pg.close();
    }
});

test("transactions commit together and roll back together", async () => {
    const pg = await createGatewayDatabase();
    try {
        const database = postgresGatewayDatabase(pg);
        const committed = await database.transaction(async (tx) => {
            await tx.query(INSERT_GRANT, [SPONSOR, NOW]);
            return "done";
        });
        assert.equal(committed, "done");
        const failure = new Error("stop");
        await assert.rejects(database.transaction(async (tx) => {
            await tx.query("UPDATE nightly_gateway.supporter_grants SET updated_at = $1 WHERE supporter_discord_user_id = $2", [NOW + 1, SPONSOR]);
            throw failure;
        }), (error) => error === failure);
        await assert.rejects(database.transaction(async (tx) => {
            await tx.query("UPDATE nightly_gateway.supporter_grants SET updated_at = $1 WHERE supporter_discord_user_id = $2", [NOW + 2, SPONSOR]);
            await tx.query(INSERT_GRANT, [SPONSOR, NOW]);
        }), (error) => isUniqueViolation(error));
        assert.deepEqual((await database.query("SELECT updated_at FROM nightly_gateway.supporter_grants")).rows, [{ updated_at: NOW }]);
        assert.deepEqual((await database.query("SELECT 1 AS ok")).rows, [{ ok: 1 }], "the connection is usable after a rollback");
    } finally {
        await pg.close();
    }
});

test("a failed rollback surfaces as an unexpected error carrying the original cause", async () => {
    const failure = new Error("stop");
    const client: PostgresClient = {
        query: async (sql) => {
            if (sql === "ROLLBACK") throw new Error("connection lost");
            return { rows: [], rowCount: 0 };
        },
    };
    await assert.rejects(postgresGatewayDatabase(client).transaction(async () => { throw failure; }), (error: Error) =>
        error.message === "gateway_transaction_rollback_failed" && error.cause === failure);
});

test("the refresh-token migration clears stored tokens and keeps the running Worker's upsert valid", async () => {
    const pg = await createGatewayDatabase(2);
    try {
        const database = postgresGatewayDatabase(pg);
        await database.query(WORKER_GRANT_UPSERT, [SPONSOR, "c".repeat(64), "n".repeat(16), NOW]);
        await applyMigration(pg, "20261115090000_nightly_gateway_retire_refresh_tokens");
        const select = "SELECT encrypted_refresh_token, token_nonce FROM nightly_gateway.supporter_grants WHERE supporter_discord_user_id = $1";
        assert.deepEqual(firstRow(await database.query(select, [SPONSOR])), { encrypted_refresh_token: null, token_nonce: null });

        await database.query(WORKER_GRANT_UPSERT, [SPONSOR, "c".repeat(64), "n".repeat(16), NOW + 1]);
        assert.deepEqual(firstRow(await database.query(select, [SPONSOR])), { encrypted_refresh_token: "c".repeat(64), token_nonce: "n".repeat(16) });

        await assert.rejects(database.query(WORKER_GRANT_UPSERT, [SPONSOR, "short", "n".repeat(16), NOW]), /supporter_grants_refresh_token/);
        await assert.rejects(database.query(WORKER_GRANT_UPSERT, [SPONSOR, "c".repeat(64), null, NOW]), /supporter_grants_refresh_token_pair/);
    } finally {
        await pg.close();
    }
});
