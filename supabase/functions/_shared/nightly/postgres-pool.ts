import { type DatabaseProvider, type PostgresClient, postgresGatewayDatabase } from "./database.ts";

// Edge-only composition of the gateway's PostgreSQL pool. The `pg` module is a parameter, so this file never
// imports a driver and the INT8 parser the gateway database relies on cannot be left unregistered.

/** A pooled `pg` connection: queries, plus release that destroys it when told the request failed. */
interface PooledClient extends PostgresClient {
    release(destroy?: boolean): void;
}

/** The slice of a `pg` Pool the provider uses. */
interface PostgresPool {
    connect(): Promise<PooledClient>;
    on(event: "error", listener: (error: unknown) => void): unknown;
}

/** The slice of the `pg` module the provider uses: the type-parser registry and the Pool class. */
export interface PostgresModule {
    types: { builtins: { INT8: number }; setTypeParser(oid: number, parse: (value: string) => number): void };
    Pool: new (config: Record<string, unknown>) => PostgresPool;
}

/** Pool sizing, timeouts and the connection's application name, chosen by the composition root. */
export type PostgresPoolOptions = {
    applicationName: string;
    maxConnections: number;
    idleTimeoutMs: number;
    /** Bounds both acquiring a connection and each query. */
    queryTimeoutMs: number;
};

/** Parses an INT8 column as a JS number, refusing values beyond the safe-integer range. */
export function parseSafeInt8(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("postgres_integer_out_of_range");
    return parsed;
}

/** Registers the safe INT8 parser, opens the pool, and returns a provider leasing one connection per request. */
export function createPostgresDatabaseProvider(
    pg: PostgresModule,
    connectionString: string,
    options: PostgresPoolOptions,
): DatabaseProvider {
    pg.types.setTypeParser(pg.types.builtins.INT8, parseSafeInt8);
    const pool = new pg.Pool({
        connectionString,
        application_name: options.applicationName,
        max: options.maxConnections,
        idleTimeoutMillis: options.idleTimeoutMs,
        connectionTimeoutMillis: options.queryTimeoutMs,
        query_timeout: options.queryTimeoutMs,
    });
    pool.on("error", logPoolError);
    return async () => {
        const client = await pool.connect();
        return { database: postgresGatewayDatabase(client), release: (failed) => client.release(failed) };
    };
}

/** Logs an idle-connection error by its SQLSTATE or driver code only, never its message. */
function logPoolError(error: unknown): void {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    console.error(JSON.stringify({ event: "nightly_gateway_pool_error", error: String(code ?? "unknown") }));
}
