// Operator email for Boosty adapter failures, sent to the committed region alert recipients
// through the shared site mail account. Fixed text only: no tokens, bodies or account data.
import type { BoostyFailure } from "./boosty-credential.ts";
import type { BoostyAlert } from "./boosty-membership.ts";
import type { RegionAlertConfig } from "./region-alerts.ts";
import type { SmtpMessage } from "./smtp.ts";

export type BoostyOperatorAlert = BoostyFailure | BoostyAlert;

const TEXT: Record<BoostyOperatorAlert, { subject: string; body: string }> = {
    rejected: {
        subject: "Boosty creator credential rejected",
        body: "Boosty refused the creator credential (refresh or API request). Membership evidence is frozen: nothing is recorded as loss, and evidence older than 24 hours becomes unknown. Sign in to Boosty, capture a new refresh token and device id, update the BOOSTY_REFRESH_TOKEN and BOOSTY_DEVICE_ID function secrets, then reset the credential store as described in docs/boosty-membership.md.",
    },
    unavailable: {
        subject: "Boosty creator credential refresh unavailable",
        body: "Refreshing the Boosty creator credential failed or could not be stored. Boosty may already have consumed the previous refresh token. Membership evidence is frozen and nothing is recorded as loss. Check the boosty-membership function logs; if the next run also fails, replace the credential as described in docs/boosty-membership.md.",
    },
    breaker_tripped: {
        subject: "Boosty subscriber count dropped past the circuit breaker",
        body: "A complete Boosty subscriber list was much shorter than the last complete one, so no evidence was written from it. Evidence older than 24 hours becomes unknown and nothing is recorded as loss. Confirm the subscriber count in Boosty, then clear the baseline as described in docs/boosty-membership.md to resume.",
    },
};

/** Builds the fixed operator email for one alert kind. */
export function boostyOperatorAlertMessage(kind: BoostyOperatorAlert, config: Pick<RegionAlertConfig, "from" | "fromName" | "recipients">): SmtpMessage {
    return {
        from: config.from, ...(config.fromName === undefined ? {} : { fromName: config.fromName }), to: [...config.recipients],
        subject: `[BannerlordCoop] ${TEXT[kind].subject}`, text: TEXT[kind].body,
    };
}
