import { createWebsiteAccountHandler } from "../_shared/website-account.ts";
import { parsePolicy } from "../_shared/membership.ts";
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
function required(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`${name} is required`); return value; }
Deno.serve(createWebsiteAccountHandler({ supabaseUrl: required("SUPABASE_URL"), serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"), policy: parsePolicy(Deno.env.get("HOSTING_MEMBERSHIP_POLICY_JSON")) }));
