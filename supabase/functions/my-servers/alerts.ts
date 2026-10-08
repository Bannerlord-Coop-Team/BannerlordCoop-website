import type { RegionAlertSettings } from "../_shared/region-alerts.ts";

// Region request and full-region alert delivery. These values are committed on purpose (this repository is
// public). Resend's SMTP username is the literal "resend"; the API key is the password and
// stays in the SMTP_PASS function secret. Ports 25 and 587 are blocked for Edge Functions.
export const REGION_ALERTS: RegionAlertSettings = {
    recipients: ["garrett.luskey@gmail.com"],
    from: "admin@bannerlordcoop.com",
    fromName: "Bannerlord Coop",
    smtp: { hostname: "smtp.resend.com", port: 465, username: "resend" },
};
