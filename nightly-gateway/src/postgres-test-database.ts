import type { PGlite } from "@electric-sql/pglite";
import { applyMigration, createGatewayDatabase } from "../../supabase/functions/nightly-gateway/test-harness.ts";
import { PostgresGatewayDatabase, type GatewayDatabase, type PostgresConnection } from "./database";

// Test support: the real nightly_gateway schema in an in-process PostgreSQL, served through the Worker's own
// production database class so its BEGIN/COMMIT/ROLLBACK transactions run for real.

const CLIENT_ARCHIVE_LIMIT_MIGRATION = "20261105200000_remove_client_archive_size_limit";
const SERVER_FILE_PATTERN = String.raw`^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$`;
const BROKEN_SERVER_FILE_ESCAPE = String.raw`\\.7z`;

// Creates an in-memory PostgreSQL with every gateway migration the Worker's tables depend on.
// The archive-limit migration only drops and re-adds its check, so applying it twice is harmless.
export async function createWorkerSchemaDatabase(): Promise<PGlite> {
    const database = await createGatewayDatabase();
    await applyMigration(database, CLIENT_ARCHIVE_LIMIT_MIGRATION);
    await repairServerFileCheck(database);
    return database;
}

// Works around a schema bug until a migration fixes it: 202608260004 writes the check as '...\\.7z$' in a
// standard-conforming string, so the regex demands a literal backslash and refuses every real server archive name.
// Rewrites only that broken definition; once the migrations carry the fix this does nothing.
async function repairServerFileCheck(database: PGlite): Promise<void> {
    const definition = await database.query<{ definition: string }>(
        "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'installer_pins_server_file'",
    );
    if (!definition.rows[0]?.definition.includes(BROKEN_SERVER_FILE_ESCAPE)) return;
    await database.exec(`
        ALTER TABLE nightly_gateway.installer_pins
            DROP CONSTRAINT installer_pins_server_file,
            ADD CONSTRAINT installer_pins_server_file CHECK (server_file_name ~ '${SERVER_FILE_PATTERN}')
    `);
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
