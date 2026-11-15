import assert from "node:assert/strict";
import { test } from "node:test";
import { firstRow, isUniqueViolation, postgresGatewayDatabase, type PostgresClient } from "../_shared/nightly/database.ts";
import { createPostgresDatabaseProvider, parseSafeInt8, type PostgresModule } from "../_shared/nightly/postgres-pool.ts";
import {
    applyMigration,
    body,
    createGatewayDatabase,
    discordScript,
    FRIEND,
    gatewayHandler,
    installerRequest,
    NOW,
    PATREON_ROLE,
    seedDevice,
    seedDownloadSession,
    seedGrant,
    SPONSOR,
} from "./test-harness.ts";

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

test("a failed rollback propagates its own error instead of the work's", async () => {
    const rollbackFailure = new Error("connection lost");
    const client: PostgresClient = {
        query: async (sql) => {
            if (sql === "ROLLBACK") throw rollbackFailure;
            return { rows: [], rowCount: 0 };
        },
    };
    await assert.rejects(
        postgresGatewayDatabase(client).transaction(async () => { throw new Error("stop"); }),
        (error) => error === rollbackFailure,
    );
});

test("a failed rollback behind a gateway error is a 500 that discards the connection", async () => {
    const pg = await createGatewayDatabase();
    try {
        await seedGrant(pg, SPONSOR);
        const approved = await seedDevice(pg, { status: "approved", discordUserId: FRIEND, sponsorId: SPONSOR });
        await seedDownloadSession(pg, FRIEND, SPONSOR, "r".repeat(43), approved.id);
        const failingRollback: PostgresClient = {
            query: async (sql, values) => {
                const result = await pg.query(sql, values);
                if (sql === "ROLLBACK") throw new Error("connection lost");
                return result;
            },
        };
        const { handler, releases } = gatewayHandler(failingRollback, discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } }));
        const response = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
        assert.deepEqual([response.status, await body(response)], [500, { error: "internal_error" }]);
        assert.deepEqual(releases, [true]);
    } finally {
        await pg.close();
    }
});

test("the Postgres provider registers the INT8 parser, then leases and releases pooled connections", async () => {
    const parsers = new Map<number, (value: string) => number>();
    const released: Array<boolean | undefined> = [];
    let poolConfig: Record<string, unknown> = {};
    const pgModule: PostgresModule = {
        types: { builtins: { INT8: 20 }, setTypeParser: (oid, parse) => { parsers.set(oid, parse); } },
        Pool: class {
            constructor(config: Record<string, unknown>) { poolConfig = config; }
            async connect() {
                return { query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }), release: (destroy?: boolean) => { released.push(destroy); } };
            }
            on() { return this; }
        },
    };
    const openDatabase = createPostgresDatabaseProvider(pgModule, "postgres://example", {
        applicationName: "test", maxConnections: 4, idleTimeoutMs: 10_000, queryTimeoutMs: 5_000,
    });
    assert.equal(parsers.get(20), parseSafeInt8);
    assert.deepEqual(poolConfig, {
        connectionString: "postgres://example", application_name: "test", max: 4,
        idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, query_timeout: 5_000,
    });
    const lease = await openDatabase();
    assert.deepEqual((await lease.database.query("SELECT 1 AS ok")).rows, [{ ok: 1 }]);
    await lease.release(false);
    await (await openDatabase()).release(true);
    assert.deepEqual(released, [false, true]);
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
