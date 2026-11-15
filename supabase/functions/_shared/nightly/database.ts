// PostgreSQL access for the nightly gateway: typed parameterized queries and transactions over a connection pool.
// A connection is held only for one statement or one transaction, never across a Discord call. Handler SQL is native
// PostgreSQL naming tables as nightly_gateway.<table>; INT8 columns arrive as JS numbers (postgres-pool.ts registers it).

/** The rows a statement returned and how many rows it inserted, updated or deleted. */
export type QueryResult<T> = { rows: T[]; rowCount: number };

/** Runs one statement with `$1`-style positional parameters. */
export interface GatewayQueries {
    query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

/** The gateway's database: single statements, plus all-or-nothing work inside one transaction. */
export interface GatewayDatabase extends GatewayQueries {
    transaction<T>(work: (tx: GatewayQueries) => Promise<T>): Promise<T>;
}

/** The slice of a `pg` client, pool or PGlite the gateway needs: positional-parameter queries. */
export interface PostgresClient {
    query(sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>;
}

/** A connection leased from a pool: queries, plus release that destroys it when told it is broken. */
export interface PooledConnection extends PostgresClient {
    release(destroy?: boolean): void;
}

/** A pool that runs single statements itself and leases a connection for a transaction (a `pg` Pool fits). */
export interface ConnectionPool extends PostgresClient {
    connect(): Promise<PooledConnection>;
}

// A pool that could not hand out a connection; carries the driver's errno code (e.g. ECONNREFUSED) for the log.
export class DatabaseUnavailableError extends Error {
    override readonly name = "DatabaseUnavailableError";
    readonly code: unknown;

    constructor(cause: unknown) {
        super("nightly_database_unavailable", { cause });
        this.code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
    }
}

/** Wraps a connection pool as the gateway's database. */
export function pooledGatewayDatabase(pool: ConnectionPool): GatewayDatabase {
    return new PooledGatewayDatabase(pool);
}

/** Returns a result's first row, or null when the statement matched nothing. */
export function firstRow<T>(result: QueryResult<T>): T | null {
    return result.rows[0] ?? null;
}

/** Whether an error is PostgreSQL's unique_violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

// Runs single statements on the pool and each transaction on one connection leased for that transaction alone.
class PooledGatewayDatabase implements GatewayDatabase {
    constructor(private readonly pool: ConnectionPool) {}

    /** Runs one statement on whichever pooled connection is free, returned to the pool when it settles. */
    query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
        return runStatement<T>(this.pool, sql, values);
    }

    /** Runs `work` in one transaction: commits its result, or rolls back and rethrows its error. */
    async transaction<T>(work: (tx: GatewayQueries) => Promise<T>): Promise<T> {
        const connection = await this.lease();
        await runControl(connection, "BEGIN");
        let result: T;
        try {
            result = await work({ query: (sql, values = []) => runStatement(connection, sql, values) });
        } catch (error) {
            await runControl(connection, "ROLLBACK");
            connection.release();
            throw error;
        }
        await runControl(connection, "COMMIT");
        connection.release();
        return result;
    }

    /** Leases a connection, reporting a pool that cannot supply one as `nightly_database_unavailable`. */
    private async lease(): Promise<PooledConnection> {
        try {
            return await this.pool.connect();
        } catch (error) {
            throw new DatabaseUnavailableError(error);
        }
    }
}

/** Runs one statement and normalizes the driver's affected-row count. */
async function runStatement<T>(client: PostgresClient, sql: string, values: readonly unknown[]): Promise<QueryResult<T>> {
    const result = await client.query(sql, [...values]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? result.affectedRows ?? 0 };
}

/** Runs BEGIN, COMMIT or ROLLBACK; when one fails the connection's state is unknown, so it is destroyed. */
async function runControl(connection: PooledConnection, sql: string): Promise<void> {
    try {
        await connection.query(sql);
    } catch (error) {
        connection.release(true);
        throw error;
    }
}
