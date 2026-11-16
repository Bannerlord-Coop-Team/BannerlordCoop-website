import type { PGlite } from "@electric-sql/pglite";
import { createGatewayDatabase, pgliteClient } from "../../supabase/functions/nightly-gateway/test-harness.ts";
import { PostgresGatewayDatabase, type GatewayDatabase } from "./database";

// Test support: the real nightly_gateway schema in an in-process PostgreSQL, served through the Worker's own
// production database class so its BEGIN/COMMIT/ROLLBACK transactions run for real.

// Creates an in-memory PostgreSQL with every nightly_gateway migration applied, as production has them.
export async function createWorkerSchemaDatabase(): Promise<PGlite> {
    return createGatewayDatabase();
}

// Serves the Worker's GatewayDatabase over PGlite through the production PostgresGatewayDatabase, using the
// harness's PGlite adapter so both deployables' tests share one rowCount rule.
export function workerDatabase(database: PGlite): GatewayDatabase {
    return new PostgresGatewayDatabase(pgliteClient(database));
}
