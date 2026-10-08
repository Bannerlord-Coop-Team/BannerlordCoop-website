import { createMyServersHandler } from "../_shared/my-servers.ts";
import { createRegionAlerts, resolveRegionAlertConfig } from "../_shared/region-alerts.ts";
import { sendSmtpMail, type SmtpSocket, type SmtpTransport } from "../_shared/smtp.ts";
import { REGION_ALERTS } from "./alerts.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
    connect(options: { hostname: string; port: number }): Promise<SmtpSocket>;
    connectTls(options: { hostname: string; port: number }): Promise<SmtpSocket>;
    startTls(connection: SmtpSocket, options: { hostname: string }): Promise<SmtpSocket>;
};

const allowedOrigins = required("CONTROL_PLANE_WEB_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

// Region alerts: recipients and the SMTP account live in ./alerts.ts; SMTP_PASS is the only secret.
const alertConfig = resolveRegionAlertConfig(REGION_ALERTS, (name) => Deno.env.get(name));
if (alertConfig === null) console.warn("SMTP_PASS is not set; region alerts are disabled");
const smtpTransport: SmtpTransport = {
    connect: (target) => Deno.connect(target),
    connectTls: (target) => Deno.connectTls(target),
    startTls: (socket, target) => Deno.startTls(socket, target),
};
const alerts = alertConfig === null ? undefined : createRegionAlerts({
    recipients: alertConfig.recipients,
    from: alertConfig.from,
    fromName: alertConfig.fromName,
    send: (message) => sendSmtpMail(smtpTransport, alertConfig.smtp, message),
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
