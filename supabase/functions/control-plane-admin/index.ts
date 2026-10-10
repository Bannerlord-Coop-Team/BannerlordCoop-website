import { createControlPlaneAdminHandler } from "../_shared/control-plane-admin.ts";
import { resolveRegionAlertConfig } from "../_shared/region-alerts.ts";
import { createRegionRequestNotifier } from "../_shared/region-request-notification.ts";
import { sendSmtpMail, type SmtpSocket, type SmtpTransport } from "../_shared/smtp.ts";
import { REGION_ALERTS } from "../my-servers/alerts.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
    connect(options: { hostname: string; port: number }): Promise<SmtpSocket>;
    connectTls(options: { hostname: string; port: number }): Promise<SmtpSocket>;
    startTls(connection: SmtpSocket, options: { hostname: string }): Promise<SmtpSocket>;
};

const publishableKeys = JSON.parse(required("SUPABASE_PUBLISHABLE_KEYS")) as Record<string, unknown>;
const publishableKey = publishableKeys.default;
if (typeof publishableKey !== "string") throw new Error("Default Supabase publishable key is unavailable");

const allowedOrigins = required("CONTROL_PLANE_WEB_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

// Requester notifications reuse the region alerts' committed sender account; SMTP_PASS is the only secret.
const mailConfig = resolveRegionAlertConfig(REGION_ALERTS, (name) => Deno.env.get(name));
if (mailConfig === null) console.warn("SMTP_PASS is not set; region request notifications are disabled");
const smtpTransport: SmtpTransport = {
    connect: (target) => Deno.connect(target),
    connectTls: (target) => Deno.connectTls(target),
    startTls: (socket, target) => Deno.startTls(socket, target),
};

Deno.serve(createControlPlaneAdminHandler({
    allowedOrigins,
    supabaseUrl: required("SUPABASE_URL"),
    supabasePublishableKey: publishableKey,
    controlPlaneAdminUrl: required("CONTROL_PLANE_ADMIN_URL"),
    notifyRegionRequest: mailConfig === null ? undefined : createRegionRequestNotifier({
        from: mailConfig.from,
        fromName: mailConfig.fromName,
        send: (message) => sendSmtpMail(smtpTransport, mailConfig.smtp, message),
    }),
}));

// Reads a required, non-empty environment variable.
function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
