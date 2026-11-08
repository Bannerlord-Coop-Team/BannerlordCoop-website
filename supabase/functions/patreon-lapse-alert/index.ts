import { denoSmtpTransport, resolveMailConfig, SITE_MAIL } from "../_shared/mail.ts";
import { createPatreonLapseAlertHandler, fetchQualifyingPatrons, lapseAlertMessage } from "../_shared/patreon-lapse-alert.ts";
import { createLapseInventoryLoader } from "../_shared/patreon-lapse-inventory.ts";
import { sendSmtpMail } from "../_shared/smtp.ts";
import { REGION_ALERTS } from "../my-servers/alerts.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const mail = resolveMailConfig(SITE_MAIL, name => Deno.env.get(name));
if (mail === null) throw new Error("SMTP_PASS is required");
const campaignId = required("PATREON_CAMPAIGN_ID");
const creatorAccessToken = required("PATREON_CREATOR_ACCESS_TOKEN");
Deno.serve(createPatreonLapseAlertHandler({
    syncSecret: required("PATREON_SYNC_SECRET"),
    loadInventory: createLapseInventoryLoader(fetch, required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY")),
    loadPatrons: () => fetchQualifyingPatrons(fetch, campaignId, creatorAccessToken),
    alert: report => sendSmtpMail(denoSmtpTransport, mail.smtp, lapseAlertMessage(report, {
        from: mail.from, ...(mail.fromName === undefined ? {} : { fromName: mail.fromName }),
        recipients: REGION_ALERTS.recipients,
    })),
}));

function required(name: string): string {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
