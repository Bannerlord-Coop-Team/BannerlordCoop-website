import type { PatreonConfig } from "./patreon.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

export function patreonConfig(): PatreonConfig {
    function required(name: string) {
        const value = Deno.env.get(name)?.trim();
        if (!value) throw new Error(`${name} is required`);
        return value;
    }
    return {
        supabaseUrl: required("SUPABASE_URL"),
        serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
        clientId: required("PATREON_CLIENT_ID"),
        clientSecret: required("PATREON_CLIENT_SECRET"),
        redirectUri: required("PATREON_REDIRECT_URI"),
        siteUrl: required("PATREON_SITE_URL"),
    };
}
