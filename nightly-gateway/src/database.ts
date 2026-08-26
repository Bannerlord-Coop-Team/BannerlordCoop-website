import { Client, types } from "pg";

const GATEWAY_SCHEMA = "nightly_gateway";
const QUERY_TIMEOUT_MS = 5_000;
const TABLE_NAMES = Object.freeze([
    "device_sessions",
    "supporter_grants",
    "sponsorships",
    "download_sessions",
    "oauth_states",
    "sponsor_sessions",
    "installer_pins",
    "pin_download_sessions",
]);

types.setTypeParser(types.builtins.INT8, (value) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("postgres_integer_out_of_range");
    return parsed;
});

export type GatewayRunResult = {
    success: boolean;
    meta: { changes: number };
};

export interface GatewayPreparedStatement {
    bind(...values: unknown[]): GatewayPreparedStatement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<GatewayRunResult>;
}

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

function isGatewayDatabase(value: unknown): value is GatewayDatabase {
    return typeof value === "object" && value !== null
        && typeof (value as GatewayDatabase).prepare === "function"
        && typeof (value as GatewayDatabase).batch === "function";
}

class PostgresGatewayDatabase implements GatewayDatabase {
    constructor(private readonly client: Client) {}

    prepare(sql: string): GatewayPreparedStatement {
        return new PostgresPreparedStatement(this.client, sql);
    }

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

class PostgresPreparedStatement implements GatewayPreparedStatement {
    readonly client: Client;
    private values: unknown[] = [];

    constructor(client: Client, private readonly sourceSql: string) {
        this.client = client;
    }

    bind(...values: unknown[]): GatewayPreparedStatement {
        this.values = values;
        return this;
    }

    async first<T>(): Promise<T | null> {
        const result = await this.execute<T>();
        return result.rows[0] ?? null;
    }

    async all<T>(): Promise<{ results: T[] }> {
        const result = await this.execute<T>();
        return { results: result.rows };
    }

    async run(): Promise<GatewayRunResult> {
        const result = await this.execute();
        return { success: true, meta: { changes: result.rowCount ?? 0 } };
    }

    private execute<T = Record<string, unknown>>() {
        const sql = postgresSql(this.sourceSql, this.values.length);
        return this.client.query<T & Record<string, unknown>>(sql, this.values);
    }
}

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
    const ignoreConflict = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);
    if (ignoreConflict) sql = sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO");
    let parameter = 0;
    sql = sql.replace(/\?/g, () => `$${++parameter}`);
    if (parameter !== valueCount) throw new Error("gateway_database_parameter_mismatch");
    if (ignoreConflict) sql = `${sql.trimEnd()}\nON CONFLICT DO NOTHING`;
    return sql;
}
