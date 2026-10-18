import { isEmailAddress, type SmtpOptions, type SmtpSocket, type SmtpTransport } from "./smtp.ts";

declare const Deno: {
    connect(options: { hostname: string; port: number }): Promise<SmtpSocket>;
    connectTls(options: { hostname: string; port: number }): Promise<SmtpSocket>;
    startTls(connection: SmtpSocket, options: { hostname: string }): Promise<SmtpSocket>;
};

// Sender and SMTP account committed with the functions; the SMTP password is the only runtime secret.
export type MailSettings = {
    from: string;
    fromName?: string;
    smtp: { hostname: string; port: number; username: string; tls?: "implicit" | "starttls" };
};
export type MailConfig = { from: string; fromName?: string; smtp: SmtpOptions };

// Site email delivery. These values are committed on purpose (this repository is public). Resend's SMTP
// username is the literal "resend"; the API key is the password and stays in the SMTP_PASS function secret.
export const SITE_MAIL: MailSettings = {
    from: "admin@bannerlordcoop.com",
    fromName: "Bannerlord Coop",
    smtp: { hostname: "smtp.resend.com", port: 465, username: "resend" },
};

// Opens SMTP connections through the Deno runtime; only usable inside an Edge Function.
export const denoSmtpTransport: SmtpTransport = {
    connect: (target) => Deno.connect(target),
    connectTls: (target) => Deno.connectTls(target),
    startTls: (socket, target) => Deno.startTls(socket, target),
};

const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;
const MAXIMUM_NAME_LENGTH = 100;
// Supabase Edge Functions cannot open outbound connections to ports 25 and 587.
const BLOCKED_PORTS = new Set([25, 587]);

// Validates the committed sender and SMTP settings first, so a bad commit fails tests and boot, then
// returns null (mail disabled) when the SMTP_PASS secret is unset.
export function resolveMailConfig(settings: MailSettings, env: (name: string) => string | undefined): MailConfig | null {
    const hostname = settings.smtp.hostname.trim();
    if (!HOSTNAME.test(hostname)) throw new Error("SMTP hostname is invalid");
    const port = settings.smtp.port;
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("SMTP port is invalid");
    if (BLOCKED_PORTS.has(port)) {
        throw new Error("SMTP ports 25 and 587 are blocked by Supabase Edge Functions; use 465 (implicit TLS) or another port the provider offers");
    }
    const username = settings.smtp.username.trim();
    if (!username) throw new Error("SMTP username is required");
    const tls = settings.smtp.tls ?? (port === 465 ? "implicit" : "starttls");
    if (tls !== "implicit" && tls !== "starttls") throw new Error("SMTP tls must be implicit or starttls");
    const from = settings.from.trim();
    if (!isEmailAddress(from)) throw new Error("Alert sender is not an email address");
    const fromName = settings.fromName?.trim();
    if (fromName !== undefined && (fromName.length === 0 || fromName.length > MAXIMUM_NAME_LENGTH || /[\x00-\x1f\x7f]/u.test(fromName))) {
        throw new Error("Alert sender name is invalid");
    }
    const password = env("SMTP_PASS")?.trim();
    if (!password) return null;
    return { from, ...(fromName === undefined ? {} : { fromName }), smtp: { hostname, port, tls, username, password } };
}
