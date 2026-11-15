// Port of nightly-gateway/src/database.ts: the D1-shaped GatewayDatabase interface over one PostgreSQL
// connection, so the gateway's SQL (`?` parameters, unqualified table names) runs unchanged.

const GATEWAY_SCHEMA = "nightly_gateway";
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

export type GatewayRunResult = {
    success: boolean;
    meta: { changes: number };
};

/** One bound SQL statement, executed for its first row, all rows, or its change count. */
export interface GatewayPreparedStatement {
    bind(...values: unknown[]): GatewayPreparedStatement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<GatewayRunResult>;
}

/** The gateway's database: prepares statements and runs a batch of them in one transaction. */
export interface GatewayDatabase {
    prepare(sql: string): GatewayPreparedStatement;
    batch(statements: GatewayPreparedStatement[]): Promise<GatewayRunResult[]>;
}

/** The slice of a `pg` client (or PGlite) the adapter needs: positional-parameter queries. */
export interface PostgresClient {
    query(sql: string, values: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>;
}

/** A request-scoped database plus the hook that returns its connection; a failed request discards it. */
export type DatabaseLease = { database: GatewayDatabase; release(failed: boolean): void | Promise<void> };

/** Hands out a database for one request; the handler always releases what it acquires. */
export type DatabaseProvider = () => Promise<DatabaseLease>;

/** Wraps one PostgreSQL connection as a GatewayDatabase. */
export function postgresGatewayDatabase(client: PostgresClient): GatewayDatabase {
    return new PostgresGatewayDatabase(client);
}

/** Parses an INT8 column as a JS number, refusing values beyond the safe-integer range. */
export function parseSafeInt8(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("postgres_integer_out_of_range");
    return parsed;
}

// Runs prepared statements on a single connection and wraps batches in BEGIN/COMMIT.
class PostgresGatewayDatabase implements GatewayDatabase {
    constructor(private readonly client: PostgresClient) {}

    /** Creates an unbound statement for this connection. */
    prepare(sql: string): GatewayPreparedStatement {
        return new PostgresPreparedStatement(this.client, sql);
    }

    /** Runs up to 16 statements from this connection atomically, rolling back on any failure. */
    async batch(statements: GatewayPreparedStatement[]): Promise<GatewayRunResult[]> {
        if (statements.length === 0 || statements.length > 16
            || statements.some((statement) => !(statement instanceof PostgresPreparedStatement)
                || statement.client !== this.client)) {
            throw new Error("gateway_database_batch_invalid");
        }
        await this.client.query("BEGIN", []);
        try {
            const results: GatewayRunResult[] = [];
            for (const statement of statements) results.push(await statement.run());
            await this.client.query("COMMIT", []);
            return results;
        } catch (error) {
            await this.rollbackQuietly();
            throw error;
        }
    }

    /** Rolls back while preserving the original query error for the caller. */
    private async rollbackQuietly(): Promise<void> {
        try {
            await this.client.query("ROLLBACK", []);
        } catch {
            // The original error is more useful; the connection is discarded by the pool on failure.
        }
    }
}

// Holds one SQL text and its bound values, translating to PostgreSQL syntax on execution.
class PostgresPreparedStatement implements GatewayPreparedStatement {
    private values: unknown[] = [];

    constructor(readonly client: PostgresClient, private readonly sourceSql: string) {}

    /** Replaces the positional values for the statement's `?` placeholders. */
    bind(...values: unknown[]): GatewayPreparedStatement {
        this.values = values;
        return this;
    }

    /** Returns the first row, or null when the query matched nothing. */
    async first<T>(): Promise<T | null> {
        const result = await this.execute();
        return (result.rows[0] as T | undefined) ?? null;
    }

    /** Returns every row. */
    async all<T>(): Promise<{ results: T[] }> {
        const result = await this.execute();
        return { results: result.rows as T[] };
    }

    /** Executes for effect and reports the affected-row count. */
    async run(): Promise<GatewayRunResult> {
        const result = await this.execute();
        return { success: true, meta: { changes: result.rowCount ?? result.affectedRows ?? 0 } };
    }

    /** Sends the translated SQL with the bound values. */
    private execute() {
        return this.client.query(postgresSql(this.sourceSql, this.values.length), this.values);
    }
}

/** Translates gateway SQL: schema-qualifies tables, numbers parameters, and maps INSERT OR IGNORE. */
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
