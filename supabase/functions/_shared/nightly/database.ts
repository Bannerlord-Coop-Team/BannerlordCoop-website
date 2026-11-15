// PostgreSQL access for the nightly gateway: typed parameterized queries and transactions over a connection pool.
// Each statement and each transaction leases its own connection, held only while it runs, never across a Discord
// call. Handler SQL is native PostgreSQL naming tables as nightly_gateway.<table>; INT8 columns arrive as JS numbers
// (postgres-pool.ts registers it).

/** A PostgreSQL SQLSTATE error code: five digits or capitals, like 23505. */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
/** A Node-style errno code naming a failed dependency, like ECONNREFUSED or ETIMEDOUT; checked before SQLSTATE. */
const ERRNO_CODE_PATTERN = /^E[A-Z]{2,20}$/;

/** The `code` property of a thrown value, when it is an object that has one. */
function codeOf(error: unknown): unknown {
    return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** The error's errno code (naming a failed connection or timeout) or else its PostgreSQL SQLSTATE, when well-formed. */
export function driverCode(error: unknown): { code?: string; sqlstate?: string } {
    const code = codeOf(error);
    if (typeof code !== "string") return {};
    if (ERRNO_CODE_PATTERN.test(code)) return { code };
    if (SQLSTATE_PATTERN.test(code)) return { sqlstate: code };
    return {};
}

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

/** The slice of a `pg` client the gateway needs: positional-parameter queries reporting pg's row count. */
export interface PostgresClient {
    query(sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** A connection leased from a pool: queries, plus release that destroys it when told it is broken. */
export interface PooledConnection extends PostgresClient {
    release(destroy?: boolean): void;
}

/** A pool that leases a connection per statement or transaction (a `pg` Pool fits). */
export interface ConnectionPool {
    connect(): Promise<PooledConnection>;
}

// A pool that could not hand out a connection; carries the driver's errno code (e.g. ECONNREFUSED) for the log.
export class DatabaseUnavailableError extends Error {
    override readonly name = "DatabaseUnavailableError";
    readonly code: unknown;

    constructor(cause: unknown) {
        super("nightly_database_unavailable", { cause });
        this.code = codeOf(cause);
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
    return codeOf(error) === "23505";
}

// Runs each statement, and each transaction, on a connection leased for it alone, so outages surface one way.
class PooledGatewayDatabase implements GatewayDatabase {
    constructor(private readonly pool: ConnectionPool) {}

    /** Runs one statement on its own leased connection, returned to the pool (or destroyed if broken) when it settles. */
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
        const connection = await this.lease();
        let result: QueryResult<T>;
        try {
            result = await runStatement<T>(connection, sql, values);
        } catch (error) {
            const destroy = !leavesConnectionReady(error);
            connection.release(destroy);
            throw error;
        }
        connection.release();
        return result;
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

/** Runs one statement and reports pg's row count, which is null for statements that count no rows. */
async function runStatement<T>(client: PostgresClient, sql: string, values: readonly unknown[]): Promise<QueryResult<T>> {
    const result = await client.query(sql, [...values]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

/**
 * Whether a failed statement left its connection ready for the next one: the server answered with an ERROR-severity
 * SQLSTATE (a constraint violation, say). A timeout, a dropped socket or a FATAL error leaves it broken or unknown.
 */
function leavesConnectionReady(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const { code, severity } = error as { code?: unknown; severity?: unknown };
    return severity === "ERROR" && typeof code === "string" && SQLSTATE_PATTERN.test(code);
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
