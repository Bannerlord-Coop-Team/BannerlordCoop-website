// @ts-nocheck -- Deno npm specifiers are validated by the Edge deployment.
import pg from "npm:pg@8.16.3";
import { parseSafeInt8, postgresGatewayDatabase } from "../_shared/nightly/database.ts";
import { createNightlyGatewayHandler } from "../_shared/nightly/gateway.ts";

// Edge Function: nightly-gateway. Owns everything that needs Discord for nightly access: installer
// device sessions (forwarded by the Worker), Discord OAuth, sponsor seats and download-token issue.

const QUERY_TIMEOUT_MS = 5_000;

/** Reads a required secret, failing the boot when it is absent. */
function required(name) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

pg.types.setTypeParser(pg.types.builtins.INT8, parseSafeInt8);
const pool = new pg.Pool({
    connectionString: required("SUPABASE_DB_URL"),
    application_name: "bannerlordcoop-nightly-gateway-edge",
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
});
pool.on("error", (error) => console.error(JSON.stringify({ event: "nightly_gateway_pool_error", error: String(error?.code ?? "unknown") })));

/** Leases one pooled connection for a request; a connection from a failed request is destroyed. */
async function openDatabase() {
    const client = await pool.connect();
    return { database: postgresGatewayDatabase(client), release: (failed) => client.release(failed) };
}

Deno.serve(createNightlyGatewayHandler({
    websiteKey: required("NIGHTLY_WEBSITE_KEY"),
    discord: {
        clientId: required("DISCORD_CLIENT_ID"),
        clientSecret: required("DISCORD_CLIENT_SECRET"),
        botToken: required("DISCORD_BOT_TOKEN"),
    },
    fetch: (input, init) => fetch(input, init),
    openDatabase,
}));
