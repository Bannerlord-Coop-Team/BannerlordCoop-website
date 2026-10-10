import { denoSmtpTransport } from "../_shared/mail.ts";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { createRegionAlerts, resolveRegionAlertConfig } from "../_shared/region-alerts.ts";
import { sendSmtpMail } from "../_shared/smtp.ts";
import { REGION_ALERTS } from "./alerts.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const allowedOrigins = required("CONTROL_PLANE_WEB_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

// Region alerts: recipients live in ./alerts.ts and the sender in ../_shared/mail.ts; SMTP_PASS is the only secret.
const alertConfig = resolveRegionAlertConfig(REGION_ALERTS, (name) => Deno.env.get(name));
if (alertConfig === null) console.warn("SMTP_PASS is not set; region alerts are disabled");
const alerts = alertConfig === null ? undefined : createRegionAlerts({
    recipients: alertConfig.recipients,
    from: alertConfig.from,
    fromName: alertConfig.fromName,
    send: (message) => sendSmtpMail(denoSmtpTransport, alertConfig.smtp, message),
});

Deno.serve(createMyServersHandler({
    allowedOrigins,
    controlPlaneUrl: required("CONTROL_PLANE_ADMIN_URL"),
    onRegionRequested: alerts?.regionRequested,
    onRegionFull: alerts?.regionFull,
}));

function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
