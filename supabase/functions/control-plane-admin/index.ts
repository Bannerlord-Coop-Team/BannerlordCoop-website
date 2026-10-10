import { createControlPlaneAdminHandler } from "../_shared/control-plane-admin.ts";
import { denoSmtpTransport, resolveMailConfig, SITE_MAIL } from "../_shared/mail.ts";
import { createRegionRequestNotifier } from "../_shared/region-request-notification.ts";
import { sendSmtpMail } from "../_shared/smtp.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const publishableKeys = JSON.parse(required("SUPABASE_PUBLISHABLE_KEYS")) as Record<string, unknown>;
const publishableKey = publishableKeys.default;
if (typeof publishableKey !== "string") throw new Error("Default Supabase publishable key is unavailable");

const allowedOrigins = required("CONTROL_PLANE_WEB_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

// Requester notification emails always link to the canonical public site, whatever origin the admin used.
const PUBLIC_SITE_URL = "https://bannerlordcoop.com";

// Requester notifications use the shared committed sender account; SMTP_PASS is the only secret.
const mailConfig = resolveMailConfig(SITE_MAIL, (name) => Deno.env.get(name));
if (mailConfig === null) console.warn("SMTP_PASS is not set; region request notifications are disabled");

Deno.serve(createControlPlaneAdminHandler({
    allowedOrigins,
    supabaseUrl: required("SUPABASE_URL"),
    supabasePublishableKey: publishableKey,
    controlPlaneAdminUrl: required("CONTROL_PLANE_ADMIN_URL"),
    notifyRegionRequest: mailConfig === null ? undefined : createRegionRequestNotifier({
        from: mailConfig.from,
        fromName: mailConfig.fromName,
        siteUrl: PUBLIC_SITE_URL,
        send: (message) => sendSmtpMail(denoSmtpTransport, mailConfig.smtp, message),
    }),
}));

// Reads a required, non-empty environment variable.
function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
