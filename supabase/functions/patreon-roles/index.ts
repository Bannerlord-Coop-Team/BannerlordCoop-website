import { createPatreonRoleHandler, createPatreonRoleRpc } from "../_shared/patreon-roles.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

const campaignId = required("PATREON_CAMPAIGN_ID");
const tierId = required("PATREON_STANDARD_TIER_ID");
Deno.serve(createPatreonRoleHandler({
    campaignId,
    tierId,
    creatorAccessToken: required("PATREON_CREATOR_ACCESS_TOKEN"),
    webhookSecret: required("PATREON_WEBHOOK_SECRET"),
    syncSecret: required("PATREON_SYNC_SECRET"),
    rpc: createPatreonRoleRpc({
        campaignId, tierId,
        supabaseUrl: required("SUPABASE_URL"),
        serviceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    }),
}));
