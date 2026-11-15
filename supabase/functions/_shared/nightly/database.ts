// PostgreSQL access for the nightly gateway: typed parameterized queries and transactions on one
// request-scoped connection. Handler SQL is native PostgreSQL and names tables as nightly_gateway.<table>.
// INT8 columns arrive as JS numbers because createPostgresDatabaseProvider (postgres-pool.ts) registers the parser.

/** The rows a statement returned and how many rows it inserted, updated or deleted. */
export type QueryResult<T> = { rows: T[]; rowCount: number };

/** Runs one statement with `$1`-style positional parameters. */
export interface GatewayQueries {
    query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

/** A request's database: single statements, plus all-or-nothing work inside one transaction. */
export interface GatewayDatabase extends GatewayQueries {
    transaction<T>(work: (tx: GatewayQueries) => Promise<T>): Promise<T>;
}

/** The slice of a `pg` client (or PGlite) the gateway needs: positional-parameter queries. */
export interface PostgresClient {
    query(sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>;
}

/** A request-scoped database plus the hook that returns its connection; a failed request discards it. */
export type DatabaseLease = { database: GatewayDatabase; release(failed: boolean): void | Promise<void> };

/** Hands out a database for one request; the handler always releases what it acquires. */
export type DatabaseProvider = () => Promise<DatabaseLease>;

/** Wraps one leased PostgreSQL connection as the gateway's database. */
export function postgresGatewayDatabase(client: PostgresClient): GatewayDatabase {
    return new PostgresGatewayDatabase(client);
}

/** Returns a result's first row, or null when the statement matched nothing. */
export function firstRow<T>(result: QueryResult<T>): T | null {
    return result.rows[0] ?? null;
}

/** Whether an error is PostgreSQL's unique_violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

// Runs statements on a single connection and wraps transactional work in BEGIN/COMMIT/ROLLBACK.
class PostgresGatewayDatabase implements GatewayDatabase {
    private readonly statements: GatewayQueries;

    constructor(private readonly client: PostgresClient) {
        // Query-only view handed to transactional work, so `tx` cannot open a nested BEGIN.
        this.statements = { query: (sql, values) => this.query(sql, values) };
    }

    /** Runs one statement and normalizes the driver's affected-row count. */
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
        const result = await this.client.query(sql, [...values]);
        return { rows: result.rows as T[], rowCount: result.rowCount ?? result.affectedRows ?? 0 };
    }

    /** Runs `work` in one transaction: commits its result, or rolls back and rethrows its error. */
    async transaction<T>(work: (tx: GatewayQueries) => Promise<T>): Promise<T> {
        await this.client.query("BEGIN");
        let result: T;
        try {
            result = await work(this.statements);
        } catch (error) {
            // A failing ROLLBACK propagates instead; being unexpected, it makes the lease discard the connection.
            await this.client.query("ROLLBACK");
            throw error;
        }
        await this.client.query("COMMIT");
        return result;
    }
}
