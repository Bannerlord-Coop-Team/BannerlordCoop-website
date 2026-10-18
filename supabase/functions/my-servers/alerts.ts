import { SITE_MAIL } from "../_shared/mail.ts";
import type { RegionAlertSettings } from "../_shared/region-alerts.ts";

// Region request and full-region alert recipients, committed on purpose (this repository is public).
// The sender and SMTP account are the shared site mail settings in ../_shared/mail.ts.
export const REGION_ALERTS: RegionAlertSettings = {
    ...SITE_MAIL,
    recipients: ["garrett.luskey@gmail.com"],
};
