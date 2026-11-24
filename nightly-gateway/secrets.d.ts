// Secrets are created with `wrangler secret put` and intentionally do not
// appear in wrangler.jsonc. The database is never a binding: production opens
// it through the generated HYPERDRIVE binding from wrangler.jsonc.
interface Env {
    PIN_MINT_SECRET?: string;
}
