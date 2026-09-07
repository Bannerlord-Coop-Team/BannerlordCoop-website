import { patreonConfig } from "../_shared/patreon-config.ts";
import { createPatreonHandler } from "../_shared/patreon.ts";

declare const Deno: {
    serve(handler: (request: Request) => Promise<Response>): void;
};

// Authentication is checked against Supabase Auth inside the handler.
Deno.serve(createPatreonHandler(patreonConfig(), "start"));
