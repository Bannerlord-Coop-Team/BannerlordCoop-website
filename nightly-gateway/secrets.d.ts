// Secrets are created with `wrangler secret put` and intentionally do not
// appear in wrangler.jsonc. DB is an injected test binding; production uses
// the generated HYPERDRIVE binding from wrangler.jsonc.
interface Env {
    DB: import("./src/database").GatewayDatabase;
    PIN_MINT_SECRET?: string;
    DATABASE_BACKEND?: "legacy-d1" | "postgres";
    MIGRATION_MODE?: "locked";
}
