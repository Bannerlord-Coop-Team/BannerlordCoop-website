import { denoSmtpTransport } from "../_shared/mail.ts";
import { resolveRegionAlertConfig } from "../_shared/region-alerts.ts";
import { sendSmtpMail } from "../_shared/smtp.ts";
import { boostyOperatorAlertMessage, type BoostyOperatorAlert } from "../_shared/boosty-alerts.ts";
import { createBoostyApi } from "../_shared/boosty-api.ts";
import { createBoostyCredential, createBoostyCredentialRpc } from "../_shared/boosty-credential.ts";
import { createBoostyMembershipHandler, createBoostySyncRpc, type BoostyAdapter } from "../_shared/boosty-membership.ts";
import { parseBoostyPolicy } from "../_shared/boosty-policy.ts";
import { REGION_ALERTS } from "../my-servers/alerts.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

// Operator alerts share the region alert recipients and site mail account; SMTP_PASS is the only mail secret.
const alertConfig = resolveRegionAlertConfig(REGION_ALERTS, (name) => Deno.env.get(name));
if (alertConfig === null) throw new Error("SMTP_PASS is required");
const supabaseUrl = required("SUPABASE_URL");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const syncSecret = required("BOOSTY_SYNC_SECRET");
// The adapter stays disabled (503 not_configured) unless the policy and both credential seeds are set.
const policy = parseBoostyPolicy(Deno.env.get("BOOSTY_MEMBERSHIP_POLICY_JSON"));
const deviceId = Deno.env.get("BOOSTY_DEVICE_ID")?.trim();
const refreshToken = Deno.env.get("BOOSTY_REFRESH_TOKEN")?.trim();
if (refreshToken !== undefined && (refreshToken === syncSecret || refreshToken === serviceKey)) throw new Error("boosty_secrets_must_be_distinct");
const alert = (kind: BoostyOperatorAlert) => sendSmtpMail(denoSmtpTransport, alertConfig.smtp, boostyOperatorAlertMessage(kind, alertConfig));

Deno.serve(createBoostyMembershipHandler({
    adapter: policy && deviceId && refreshToken ? adapter(policy, deviceId, refreshToken) : null,
    syncSecret,
    rpc: createBoostySyncRpc({ supabaseUrl, serviceKey }),
    alert,
}));

// Wires the Vault-backed credential and the bounded API client for the configured blog.
function adapter(configured: NonNullable<typeof policy>, device: string, refresh: string): BoostyAdapter {
    const credential = createBoostyCredential({ bootstrap: { deviceId: device, refreshToken: refresh }, rpc: createBoostyCredentialRpc({ supabaseUrl, serviceKey }), alert });
    return { policy: configured, credential, api: createBoostyApi({ blog: configured.blog, priceField: configured.priceField, credential }) };
}

// Reads a required function secret or fails at boot.
function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
