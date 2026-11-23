import { parsePolicy } from "../_shared/membership.ts";
import { createCreatorTokenProvider, createCreatorTokenRpc, staticCreatorToken } from "../_shared/patreon-creator-token.ts";
import { createPatreonRoleHandler, createPatreonRoleRpc } from "../_shared/patreon-roles.ts";
import { createLossBreakerRpc, massLossAlertMessage } from "../_shared/loss-breaker.ts";
import { denoSmtpTransport } from "../_shared/mail.ts";
import { resolveRegionAlertConfig } from "../_shared/region-alerts.ts";
import { sendSmtpMail } from "../_shared/smtp.ts";
import { REGION_ALERTS } from "../my-servers/alerts.ts";

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
const supabaseUrl = required("SUPABASE_URL");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const creatorAccessToken = required("PATREON_CREATOR_ACCESS_TOKEN");
const webhookSecret = required("PATREON_WEBHOOK_SECRET");
const syncSecret = required("PATREON_SYNC_SECRET");
// With a refresh token the function secrets only seed the Vault-backed store; the worker rotates
// the pair ahead of expiry. Without one the access token is used as-is.
const creatorRefreshToken = Deno.env.get("PATREON_CREATOR_REFRESH_TOKEN")?.trim();
const secrets = [creatorAccessToken, webhookSecret, syncSecret, ...(creatorRefreshToken ? [creatorRefreshToken] : [])];
if (new Set(secrets).size !== secrets.length) throw new Error("patreon_secrets_must_be_distinct");
// Mass-loss alerts share the region alert recipients; without SMTP_PASS loss is still withheld, only unannounced.
const alertConfig = resolveRegionAlertConfig(REGION_ALERTS, (name) => Deno.env.get(name));

Deno.serve(createPatreonRoleHandler({
    campaignId,
    tierId,
    allocationPolicy: parsePolicy(Deno.env.get("HOSTING_MEMBERSHIP_WEBHOOK_POLICY_JSON")),
    creatorToken: creatorRefreshToken
        ? createCreatorTokenProvider({
            clientId: required("PATREON_CLIENT_ID"),
            clientSecret: required("PATREON_CLIENT_SECRET"),
            bootstrap: { accessToken: creatorAccessToken, refreshToken: creatorRefreshToken },
            rpc: createCreatorTokenRpc({ supabaseUrl, serviceKey }),
        })
        : staticCreatorToken(creatorAccessToken),
    webhookSecret,
    syncSecret,
    rpc: createPatreonRoleRpc({ campaignId, tierId, supabaseUrl, serviceKey }),
    lossBreaker: createLossBreakerRpc({ supabaseUrl, serviceKey, provider: "patreon" }),
    alert: async () => {
        if (alertConfig === null) return console.error("Patreon mass-loss alert skipped: SMTP_PASS is not set");
        await sendSmtpMail(denoSmtpTransport, alertConfig.smtp, massLossAlertMessage("patreon", alertConfig));
    },
}));
