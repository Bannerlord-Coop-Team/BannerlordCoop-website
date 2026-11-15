import type { PGlite } from "@electric-sql/pglite";
import { createGatewayDatabase } from "../../supabase/functions/nightly-gateway/test-harness.ts";
import { PostgresGatewayDatabase, type GatewayDatabase, type PostgresConnection } from "./database";

// Test support: the real nightly_gateway schema in an in-process PostgreSQL, served through the Worker's own
// production database class so its BEGIN/COMMIT/ROLLBACK transactions run for real.

// Creates an in-memory PostgreSQL with every nightly_gateway migration applied, as production has them.
export async function createWorkerSchemaDatabase(): Promise<PGlite> {
    return createGatewayDatabase();
}

// Serves the Worker's GatewayDatabase over PGlite through the production PostgresGatewayDatabase.
export function workerDatabase(database: PGlite): GatewayDatabase {
    return new PostgresGatewayDatabase(pgliteConnection(database));
}

// Adapts PGlite to the pg-shaped connection, reporting pg's rowCount: rows read by a SELECT, rows changed otherwise.
function pgliteConnection(database: PGlite): PostgresConnection {
    return {
        async query(sql, values) {
            const result = await database.query(sql, values);
            return { rows: result.rows, rowCount: Math.max(result.affectedRows ?? 0, result.rows.length) };
        },
    };
}
