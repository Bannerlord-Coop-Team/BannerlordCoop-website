import { Client, types } from "pg";

const QUERY_TIMEOUT_MS = 5_000;

// Parses Postgres BIGINT columns as numbers, refusing values JavaScript cannot hold exactly.
types.setTypeParser(types.builtins.INT8, (value) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("postgres_integer_out_of_range");
    return parsed;
});

/** The outcome of one statement: the rows it returned and the number of rows it read or changed. */
export type GatewayQueryResult<T> = {
    rows: T[];
    rowCount: number;
};

/** Runs one parameterized Postgres statement ($n placeholders, schema-qualified tables). */
export interface GatewayQuery {
    query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<GatewayQueryResult<T>>;
}

/** The request's Postgres access the gateway modules depend on, opened by createGateway's openDatabase dependency. */
export interface GatewayDatabase extends GatewayQuery {
    transaction<T>(work: (database: GatewayQuery) => Promise<T>): Promise<T>;
}

// Returns a lookup's single row, or null when the statement matched nothing.
export function firstRow<T>(result: GatewayQueryResult<T>): T | null {
    return result.rows[0] ?? null;
}

/** The Worker bindings plus the request's opened database, as the Postgres-backed route handlers receive them. */
export type RequestEnv = Env & { DB: GatewayDatabase };

/** The connection slice the gateway runs statements on: a pg Client in production, any adapted driver in tests. */
export interface PostgresConnection {
    query(sql: string, values: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** The only binding the production database opener reads: the Hyperdrive connection string. */
type HyperdriveEnvironment = { HYPERDRIVE?: { connectionString: string } };

// Opens the request's Postgres connection through Hyperdrive, the only production store since the Edge Function split.
// A missing or malformed binding fails closed.
export async function openHyperdriveDatabase(env: HyperdriveEnvironment): Promise<GatewayDatabase> {
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

// Runs the gateway's statements on one request-scoped connection, wrapping transactions in BEGIN/COMMIT/ROLLBACK.
export class PostgresGatewayDatabase implements GatewayDatabase {
    constructor(private readonly client: PostgresConnection) {}

    // Runs one parameterized statement and returns its rows and affected-row count.
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<GatewayQueryResult<T>> {
        const result = await this.client.query(sql, [...values]);
        return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    }

    // Runs the work in one transaction, committing its result or rolling back on the first failure.
    async transaction<T>(work: (database: GatewayQuery) => Promise<T>): Promise<T> {
        await this.client.query("BEGIN", []);
        try {
            const result = await work(this);
            await this.client.query("COMMIT", []);
            return result;
        } catch (error) {
            await this.rollbackQuietly();
            throw error;
        }
    }

    // Rolls back the open transaction, keeping the caller's original error; the connection is discarded anyway.
    private async rollbackQuietly(): Promise<void> {
        try {
            await this.client.query("ROLLBACK", []);
        } catch {
            // The request-scoped connection is discarded, so a failed rollback changes nothing.
        }
    }
}
