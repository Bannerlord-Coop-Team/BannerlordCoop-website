// @ts-nocheck -- Deno npm specifiers are validated by the Edge deployment.
import pg from "npm:pg@8.16.3";
import { createNightlyGatewayHandler } from "../_shared/nightly/gateway.ts";
import { logToStderr } from "../_shared/nightly/log.ts";
import { createPostgresGatewayDatabase } from "../_shared/nightly/postgres-pool.ts";

// Edge Function: nightly-gateway. Owns everything that needs Discord for nightly access: installer
// device sessions (forwarded by the Worker), Discord OAuth, sponsor seats and download-token issue.

const QUERY_TIMEOUT_MS = 5_000;

/** Reads a required secret, failing the boot when it is absent. */
function required(name) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

/** Reads an optional setting; unset or blank is undefined, leaving the gateway's default. */
function optional(name) {
    return Deno.env.get(name)?.trim() || undefined;
}

/** The one structured-log sink shared by the request handler and the connection pool. */
const log = logToStderr;

Deno.serve(createNightlyGatewayHandler({
    websiteKey: required("NIGHTLY_WEBSITE_KEY"),
    discord: {
        clientId: required("DISCORD_CLIENT_ID"),
        clientSecret: required("DISCORD_CLIENT_SECRET"),
        botToken: required("DISCORD_BOT_TOKEN"),
        // Local stacks and previews point Discord back at their own /nightly/callback; production leaves it unset.
        redirectUri: optional("DISCORD_REDIRECT_URI"),
    },
    // Wrapped rather than passed bare, so fetch is never called with a foreign `this` ("Illegal invocation").
    fetch: (input, init) => fetch(input, init),
    database: createPostgresGatewayDatabase(pg, required("SUPABASE_DB_URL"), {
        applicationName: "bannerlordcoop-nightly-gateway-edge",
        maxConnections: 4,
        idleTimeoutMs: 10_000,
        queryTimeoutMs: QUERY_TIMEOUT_MS,
        log,
    }),
    log,
}));
