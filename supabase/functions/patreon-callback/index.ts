import { patreonConfig } from "../_shared/patreon-config.ts";
import { createPatreonHandler } from "../_shared/patreon.ts";

declare const Deno: {
    serve(handler: (request: Request) => Promise<Response>): void;
};

// Patreon redirects cannot carry Supabase JWTs; single-use state and a secure
// browser cookie authenticate the callback instead.
Deno.serve(createPatreonHandler(patreonConfig(), "callback"));
