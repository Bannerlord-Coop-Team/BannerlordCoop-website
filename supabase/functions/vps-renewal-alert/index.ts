import { denoSmtpTransport } from "../_shared/mail.ts";
import { resolveRegionAlertConfig } from "../_shared/region-alerts.ts";
import { sendSmtpMail } from "../_shared/smtp.ts";
import { createVpsRenewalAlertHandler, createVpsRenewalHostLoader, vpsRenewalAlertMessage } from "../_shared/vps-renewal-alert.ts";
import { REGION_ALERTS } from "../my-servers/alerts.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

// Operator alerts share the region alert recipients and site mail account; SMTP_PASS is the only mail secret.
const alertConfig = resolveRegionAlertConfig(REGION_ALERTS, (name) => Deno.env.get(name));
if (alertConfig === null) throw new Error("SMTP_PASS is required");

Deno.serve(createVpsRenewalAlertHandler({
    syncSecret: required("PATREON_SYNC_SECRET"),
    loadHosts: createVpsRenewalHostLoader(fetch, required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY")),
    alert: (check, now) => sendSmtpMail(denoSmtpTransport, alertConfig.smtp, vpsRenewalAlertMessage(check, now, alertConfig)),
}));

// Reads a required function secret or fails at boot.
function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
