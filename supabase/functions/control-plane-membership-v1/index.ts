import { createControlPlaneMembershipHandler } from "../_shared/control-plane-membership.ts";
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
function required(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`${name} is required`); return value; }
Deno.serve(createControlPlaneMembershipHandler({ supabaseUrl: required("SUPABASE_URL"), serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"), syncToken: required("HOSTING_MEMBERSHIP_SYNC_TOKEN") }));
