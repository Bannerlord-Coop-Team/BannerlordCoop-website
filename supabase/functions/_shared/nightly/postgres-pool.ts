import { type ConnectionPool, driverCode, type GatewayDatabase, pooledGatewayDatabase } from "./database.ts";
import type { GatewayLog } from "./log.ts";

// Edge-only composition of the gateway's PostgreSQL pool. The `pg` module is a parameter, so this file never
// imports a driver and the INT8 parser the gateway database relies on cannot be left unregistered.

/** The slice of a `pg` Pool the gateway uses: connection leases and idle-client errors. */
interface PostgresPool extends ConnectionPool {
    on(event: "error", listener: (error: unknown) => void): unknown;
}

/** The slice of the `pg` module the gateway uses: the type-parser registry and the Pool class. */
export interface PostgresModule {
    types: { builtins: { INT8: number }; setTypeParser(oid: number, parse: (value: string) => number): void };
    Pool: new (config: Record<string, unknown>) => PostgresPool;
}

/** Pool sizing, timeouts, the connection's application name and the log sink, chosen by the composition root. */
export type PostgresPoolOptions = {
    applicationName: string;
    maxConnections: number;
    idleTimeoutMs: number;
    /** Bounds both acquiring a connection and each query. */
    queryTimeoutMs: number;
    /** Receives one structured event per idle-connection error; the composition root picks the sink. */
    log: GatewayLog;
};

/** Parses an INT8 column as a JS number, refusing values beyond the safe-integer range. */
export function parseSafeInt8(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("postgres_integer_out_of_range");
    return parsed;
}

/** Registers the safe INT8 parser, opens the pool, and returns the gateway database backed by it. */
export function createPostgresGatewayDatabase(
    pg: PostgresModule,
    connectionString: string,
    options: PostgresPoolOptions,
): GatewayDatabase {
    pg.types.setTypeParser(pg.types.builtins.INT8, parseSafeInt8);
    const pool = new pg.Pool({
        connectionString,
        application_name: options.applicationName,
        max: options.maxConnections,
        idleTimeoutMillis: options.idleTimeoutMs,
        connectionTimeoutMillis: options.queryTimeoutMs,
        query_timeout: options.queryTimeoutMs,
    });
    pool.on("error", (error) => options.log(poolErrorEvent(error)));
    return pooledGatewayDatabase(pool);
}

/** Describes an idle-connection error by its well-formed errno code or SQLSTATE only, never its message. */
function poolErrorEvent(error: unknown): Record<string, unknown> {
    return { event: "nightly_gateway_pool_error", ...driverCode(error) };
}
