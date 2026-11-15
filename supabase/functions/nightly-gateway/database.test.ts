import assert from "node:assert/strict";
import { test } from "node:test";
import {
    type ConnectionPool,
    DatabaseUnavailableError,
    firstRow,
    isUniqueViolation,
    pooledGatewayDatabase,
    type PooledConnection,
} from "../_shared/nightly/database.ts";
import { createPostgresGatewayDatabase, parseSafeInt8, type PostgresModule } from "../_shared/nightly/postgres-pool.ts";
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
    singleConnectionDatabase,
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

/** What a scripted pool saw: statements it ran itself, statements per leased connection, and each release. */
type PoolTrace = { poolStatements: string[]; connectionStatements: string[]; releases: Array<boolean | undefined> };

/** A pool that answers every statement with one row, failing the statement named by `failOn` on leased connections. */
function scriptedPool(failOn?: string): { pool: ConnectionPool; trace: PoolTrace } {
    const trace: PoolTrace = { poolStatements: [], connectionStatements: [], releases: [] };
    const connection: PooledConnection = {
        query: async (sql) => {
            trace.connectionStatements.push(sql);
            if (sql === failOn) throw new Error("connection lost");
            return { rows: [{ ok: 1 }], rowCount: 1 };
        },
        release: (destroy) => { trace.releases.push(destroy); },
    };
    const pool: ConnectionPool = {
        query: async (sql) => {
            trace.poolStatements.push(sql);
            return { rows: [{ ok: 1 }], rowCount: 1 };
        },
        connect: async () => connection,
    };
    return { pool, trace };
}

test("INT8 columns parse as safe JavaScript numbers only", () => {
    assert.equal(parseSafeInt8("1800000000"), 1_800_000_000);
    assert.throws(() => parseSafeInt8("9223372036854775807"), /postgres_integer_out_of_range/);
});

test("queries return typed rows and the affected-row count", async () => {
    const pg = await createGatewayDatabase();
    try {
        const database = singleConnectionDatabase(pg);
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

test("transactions commit together and roll back together, and later queries still work", async () => {
    const pg = await createGatewayDatabase();
    try {
        const database = singleConnectionDatabase(pg);
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
        assert.deepEqual((await database.query("SELECT 1 AS ok")).rows, [{ ok: 1 }], "statements still run after a rollback");
        assert.equal(await database.transaction(async (tx) => firstRow(await tx.query<{ ok: number }>("SELECT 1 AS ok"))?.ok), 1);
    } finally {
        await pg.close();
    }
});

test("single statements run on the pool; only a transaction leases a connection, returned healthy when it ends", async () => {
    const { pool, trace } = scriptedPool();
    const database = pooledGatewayDatabase(pool);
    await database.query("SELECT 1");
    assert.deepEqual(trace, { poolStatements: ["SELECT 1"], connectionStatements: [], releases: [] });
    await database.transaction(async (tx) => { await tx.query("SELECT 2"); });
    assert.deepEqual(trace.connectionStatements, ["BEGIN", "SELECT 2", "COMMIT"]);
    assert.deepEqual(trace.releases, [undefined]);
    const failure = new Error("stop");
    await assert.rejects(database.transaction(async () => { throw failure; }), (error) => error === failure);
    assert.deepEqual(trace.connectionStatements.slice(3), ["BEGIN", "ROLLBACK"]);
    assert.deepEqual(trace.releases, [undefined, undefined], "a rolled-back connection goes back to the pool");
});

test("a failed rollback destroys the connection and propagates its own error instead of the work's", async () => {
    const { pool, trace } = scriptedPool("ROLLBACK");
    await assert.rejects(
        pooledGatewayDatabase(pool).transaction(async () => { throw new Error("stop"); }),
        (error) => error instanceof Error && error.message === "connection lost",
    );
    assert.deepEqual(trace.releases, [true]);
});

test("a failed commit destroys the connection", async () => {
    const { pool, trace } = scriptedPool("COMMIT");
    await assert.rejects(pooledGatewayDatabase(pool).transaction(async () => "done"), /connection lost/);
    assert.deepEqual(trace.releases, [true]);
});

test("a pool that cannot supply a connection is nightly_database_unavailable with the driver's errno code", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
    const pool: ConnectionPool = {
        query: async () => ({ rows: [] }),
        connect: async () => { throw refused; },
    };
    await assert.rejects(pooledGatewayDatabase(pool).transaction(async () => "unused"), (error) =>
        error instanceof DatabaseUnavailableError && error.message === "nightly_database_unavailable"
        && error.code === "ECONNREFUSED" && error.cause === refused);
});

test("a failed rollback behind a gateway error is a 500, and the gateway keeps serving", async () => {
    const pg = await createGatewayDatabase();
    try {
        await seedGrant(pg, SPONSOR);
        const approved = await seedDevice(pg, { status: "approved", discordUserId: FRIEND, sponsorId: SPONSOR });
        await seedDownloadSession(pg, FRIEND, SPONSOR, "r".repeat(43), approved.id);
        const failingRollback = {
            query: async (sql: string, values?: unknown[]) => {
                const result = await pg.query(sql, values);
                if (sql === "ROLLBACK") throw new Error("connection lost");
                return result;
            },
        };
        const { handler } = gatewayHandler(failingRollback, discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } }));
        const response = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
        assert.deepEqual([response.status, await body(response)], [500, { error: "internal_error" }]);
        const [device] = (await pg.query<{ status: string }>("SELECT status FROM nightly_gateway.device_sessions WHERE id = $1", [approved.id])).rows;
        assert.equal(device!.status, "approved", "the consuming update was rolled back");
        assert.equal((await handler(installerRequest("/v1/device/sessions"))).status, 201);
    } finally {
        await pg.close();
    }
});

test("the Postgres database registers the INT8 parser and runs statements on the pool, transactions on a lease", async () => {
    const parsers = new Map<number, (value: string) => number>();
    const trace: string[] = [];
    let poolConfig: Record<string, unknown> = {};
    const pgModule: PostgresModule = {
        types: { builtins: { INT8: 20 }, setTypeParser: (oid, parse) => { parsers.set(oid, parse); } },
        Pool: class {
            constructor(config: Record<string, unknown>) { poolConfig = config; }
            async query(sql: string) {
                trace.push(`pool ${sql}`);
                return { rows: [{ ok: 1 }], rowCount: 1 };
            }
            async connect() {
                return {
                    query: async (sql: string) => { trace.push(`lease ${sql}`); return { rows: [], rowCount: 0 }; },
                    release: (destroy?: boolean) => { trace.push(`release ${destroy}`); },
                };
            }
            on() { return this; }
        },
    };
    const database = createPostgresGatewayDatabase(pgModule, "postgres://example", {
        applicationName: "test", maxConnections: 4, idleTimeoutMs: 10_000, queryTimeoutMs: 5_000,
    });
    assert.equal(parsers.get(20), parseSafeInt8);
    assert.deepEqual(poolConfig, {
        connectionString: "postgres://example", application_name: "test", max: 4,
        idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, query_timeout: 5_000,
    });
    assert.deepEqual((await database.query("SELECT 1 AS ok")).rows, [{ ok: 1 }]);
    await database.transaction(async (tx) => { await tx.query("SELECT 2"); });
    assert.deepEqual(trace, ["pool SELECT 1 AS ok", "lease BEGIN", "lease SELECT 2", "lease COMMIT", "release undefined"]);
});

test("an idle-connection error is logged by its code only, never its message", () => {
    let listener: ((error: unknown) => void) | undefined;
    const logs: Record<string, unknown>[] = [];
    const pgModule: PostgresModule = {
        types: { builtins: { INT8: 20 }, setTypeParser: () => {} },
        Pool: class {
            async query() { return { rows: [] }; }
            async connect(): Promise<PooledConnection> { throw new Error("unused"); }
            on(_event: "error", errorListener: (error: unknown) => void) { listener = errorListener; return this; }
        },
    };
    createPostgresGatewayDatabase(pgModule, "postgres://example", {
        applicationName: "test", maxConnections: 4, idleTimeoutMs: 10_000, queryTimeoutMs: 5_000, log: (event) => logs.push(event),
    });
    listener!(Object.assign(new Error("terminating connection for user secret-admin"), { code: "57P01" }));
    listener!(new Error("password authentication failed for secret-admin"));
    assert.deepEqual(logs, [
        { event: "nightly_gateway_pool_error", error: "57P01" },
        { event: "nightly_gateway_pool_error", error: "unknown" },
    ]);
    assert.ok(!JSON.stringify(logs).includes("secret-admin"));
});

test("the refresh-token migration clears stored tokens and keeps the running Worker's upsert valid", async () => {
    const pg = await createGatewayDatabase(2);
    try {
        const database = singleConnectionDatabase(pg);
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
