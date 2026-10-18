import { denoSmtpTransport, resolveMailConfig, SITE_MAIL } from "../_shared/mail.ts";
import { sendSmtpMail } from "../_shared/smtp.ts";
import { createSubscriptionGraceAlertHandler, createSubscriptionGraceStore } from "../_shared/subscription-grace-alert.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const PUBLIC_SITE_URL = "https://bannerlordcoop.com";

// Owner removal warnings use the shared site mail account; SMTP_PASS is the only mail secret.
const mailConfig = resolveMailConfig(SITE_MAIL, (name) => Deno.env.get(name));
if (mailConfig === null) throw new Error("SMTP_PASS is required");

Deno.serve(createSubscriptionGraceAlertHandler({
    from: mailConfig.from,
    ...(mailConfig.fromName === undefined ? {} : { fromName: mailConfig.fromName }),
    syncSecret: required("PATREON_SYNC_SECRET"),
    siteUrl: PUBLIC_SITE_URL,
    store: createSubscriptionGraceStore(fetch, required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY")),
    send: (message) => sendSmtpMail(denoSmtpTransport, mailConfig.smtp, message),
}));

// Reads a required function secret or fails at boot.
function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
