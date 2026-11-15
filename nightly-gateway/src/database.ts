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

/** The request's Postgres access the gateway modules depend on, served by pg in production and fakes in tests. */
export interface GatewayDatabase extends GatewayQuery {
    transaction<T>(work: (database: GatewayQuery) => Promise<T>): Promise<T>;
}

// Returns a lookup's single row, or null when the statement matched nothing.
export function firstRow<T>(result: GatewayQueryResult<T>): T | null {
    return result.rows[0] ?? null;
}

type HyperdriveBinding = { connectionString: string };
type DatabaseEnvironment = {
    DB?: GatewayDatabase;
    HYPERDRIVE?: HyperdriveBinding;
};

// Picks the request's database: an injected test database, otherwise a new Hyperdrive Postgres client.
// Postgres is the only production store since the Edge Function split; a missing Hyperdrive binding fails closed.
export async function databaseForRequest(env: DatabaseEnvironment): Promise<GatewayDatabase> {
    if (isGatewayDatabase(env.DB)) return env.DB;
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

// Tells whether a binding exposes the query and transaction calls the gateway needs.
function isGatewayDatabase(value: unknown): value is GatewayDatabase {
    return typeof value === "object" && value !== null
        && typeof (value as GatewayDatabase).query === "function"
        && typeof (value as GatewayDatabase).transaction === "function";
}

// Runs the gateway's statements on one request-scoped pg Client, wrapping transactions in BEGIN/COMMIT.
class PostgresGatewayDatabase implements GatewayDatabase {
    constructor(private readonly client: Client) {}

    // Runs one parameterized statement and returns its rows and affected-row count.
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<GatewayQueryResult<T>> {
        const result = await this.client.query<T & Record<string, unknown>>(sql, [...values]);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    }

    // Runs the work in one transaction, committing its result or rolling back on the first failure.
    async transaction<T>(work: (database: GatewayQuery) => Promise<T>): Promise<T> {
        await this.client.query("BEGIN");
        try {
            const result = await work(this);
            await this.client.query("COMMIT");
            return result;
        } catch (error) {
            await this.rollbackQuietly();
            throw error;
        }
    }

    // Rolls back the open transaction, keeping the caller's original error; the connection is discarded anyway.
    private async rollbackQuietly(): Promise<void> {
        try {
            await this.client.query("ROLLBACK");
        } catch {
            // The request-scoped connection is discarded, so a failed rollback changes nothing.
        }
    }
}
