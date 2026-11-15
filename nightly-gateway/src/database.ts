import { Client, types } from "pg";

const GATEWAY_SCHEMA = "nightly_gateway";
const QUERY_TIMEOUT_MS = 5_000;
// The only gateway tables the Worker still reads or writes; device, sponsor, and OAuth state moved to the Edge Function.
const TABLE_NAMES = Object.freeze([
    "download_sessions",
    "installer_pins",
    "pin_download_sessions",
]);

// Parses Postgres BIGINT columns as numbers, refusing values JavaScript cannot hold exactly.
types.setTypeParser(types.builtins.INT8, (value) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("postgres_integer_out_of_range");
    return parsed;
});

/** The outcome of one write statement: success and the number of rows it changed. */
export type GatewayRunResult = {
    success: boolean;
    meta: { changes: number };
};

/** One parameterized query the gateway binds and then reads or runs. */
export interface GatewayPreparedStatement {
    bind(...values: unknown[]): GatewayPreparedStatement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<GatewayRunResult>;
}

/** The D1-shaped database surface the gateway modules depend on, so Postgres and D1 are interchangeable. */
export interface GatewayDatabase {
    prepare(sql: string): GatewayPreparedStatement;
    batch(statements: GatewayPreparedStatement[]): Promise<GatewayRunResult[]>;
}

type HyperdriveBinding = { connectionString: string };
type DatabaseEnvironment = {
    DB?: GatewayDatabase;
    HYPERDRIVE?: HyperdriveBinding;
    LEGACY_DB?: GatewayDatabase;
    DATABASE_BACKEND?: string;
};

// Picks the request's database: an injected one, the explicitly selected legacy D1, or a new Hyperdrive Postgres client.
// Any other configuration fails closed.
export async function databaseForRequest(env: DatabaseEnvironment): Promise<GatewayDatabase> {
    if (isGatewayDatabase(env.DB)) return env.DB;
    if (env.DATABASE_BACKEND === "legacy-d1") {
        if (!isGatewayDatabase(env.LEGACY_DB)) throw new Error("gateway_legacy_database_configuration_invalid");
        return env.LEGACY_DB;
    }
    if (env.DATABASE_BACKEND !== undefined && env.DATABASE_BACKEND !== "postgres") {
        throw new Error("gateway_database_backend_invalid");
    }
    const connectionString = env.HYPERDRIVE?.connectionString;
    if (typeof connectionString !== "string" || connectionString.length < 16 || connectionString.length > 8_192) {
        throw new Error("gateway_database_configuration_invalid");
    }
    const client = new Client({
        connectionString,
        application_name: "bannerlordcoop-nightly-gateway",
        connectionTimeoutMillis: QUERY_TIMEOUT_MS,
        query_timeout: QUERY_TIMEOUT_MS,
        statement_timeout: QUERY_TIMEOUT_MS,
    });
    await client.connect();
    return new PostgresGatewayDatabase(client);
}

// Tells whether a binding exposes the prepare and batch calls the gateway needs.
function isGatewayDatabase(value: unknown): value is GatewayDatabase {
    return typeof value === "object" && value !== null
        && typeof (value as GatewayDatabase).prepare === "function"
        && typeof (value as GatewayDatabase).batch === "function";
}

// Adapts one request-scoped Postgres client to the D1-shaped GatewayDatabase, running batches in a transaction.
class PostgresGatewayDatabase implements GatewayDatabase {
    constructor(private readonly client: Client) {}

    // Starts a statement bound to this client.
    prepare(sql: string): GatewayPreparedStatement {
        return new PostgresPreparedStatement(this.client, sql);
    }

    // Runs up to 16 of this client's statements in one transaction, rolling back on the first failure.
    async batch(statements: GatewayPreparedStatement[]): Promise<GatewayRunResult[]> {
        if (statements.length === 0 || statements.length > 16
            || statements.some((statement) => !(statement instanceof PostgresPreparedStatement)
                || statement.client !== this.client)) {
            throw new Error("gateway_database_batch_invalid");
        }
        await this.client.query("BEGIN");
        try {
            const results: GatewayRunResult[] = [];
            for (const statement of statements) results.push(await statement.run());
            await this.client.query("COMMIT");
            return results;
        } catch (error) {
            try {
                await this.client.query("ROLLBACK");
            } catch {
                // Preserve the original query error; the request-scoped connection is discarded.
            }
            throw error;
        }
    }
}

// Holds one D1-style SQL statement and its bound values until it runs on Postgres.
class PostgresPreparedStatement implements GatewayPreparedStatement {
    readonly client: Client;
    private values: unknown[] = [];

    constructor(client: Client, private readonly sourceSql: string) {
        this.client = client;
    }

    // Replaces the statement's bound values.
    bind(...values: unknown[]): GatewayPreparedStatement {
        this.values = values;
        return this;
    }

    // Returns the first result row, or null when there is none.
    async first<T>(): Promise<T | null> {
        const result = await this.execute<T>();
        return result.rows[0] ?? null;
    }

    // Returns every result row.
    async all<T>(): Promise<{ results: T[] }> {
        const result = await this.execute<T>();
        return { results: result.rows };
    }

    // Runs the statement and reports how many rows it changed.
    async run(): Promise<GatewayRunResult> {
        const result = await this.execute();
        return { success: true, meta: { changes: result.rowCount ?? 0 } };
    }

    // Translates the D1 SQL to Postgres and runs it with the bound values.
    private execute<T = Record<string, unknown>>() {
        const sql = postgresSql(this.sourceSql, this.values.length);
        return this.client.query<T & Record<string, unknown>>(sql, this.values);
    }
}

// Translates D1-style SQL to Postgres: schema-qualified gateway tables and $n parameters.
// Throws when the SQL is empty or oversized or its placeholders do not match the value count.
export function postgresSql(sourceSql: string, valueCount: number): string {
    if (typeof sourceSql !== "string" || sourceSql.length === 0 || sourceSql.length > 16_384
        || !Number.isSafeInteger(valueCount) || valueCount < 0 || valueCount > 32) {
        throw new Error("gateway_database_query_invalid");
    }
    let sql = sourceSql;
    for (const tableName of TABLE_NAMES) {
        sql = sql.replace(
            new RegExp(`(?<![A-Za-z0-9_.])${tableName}(?![A-Za-z0-9_])`, "g"),
            `"${GATEWAY_SCHEMA}"."${tableName}"`,
        );
    }
    let parameter = 0;
    sql = sql.replace(/\?/g, () => `$${++parameter}`);
    if (parameter !== valueCount) throw new Error("gateway_database_parameter_mismatch");
    return sql;
}
