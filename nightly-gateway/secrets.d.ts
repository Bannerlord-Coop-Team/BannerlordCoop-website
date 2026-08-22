// Secrets are created with `wrangler secret put` and intentionally do not
// appear in wrangler.jsonc. This augments the generated non-secret bindings.
interface Env {
    DISCORD_BOT_TOKEN: string;
    DISCORD_CLIENT_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;
    PIN_MINT_SECRET?: string;
}
