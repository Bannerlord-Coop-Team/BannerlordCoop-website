// Mass-reclassification breaker shared by the Patreon and Boosty workers. Each run reports the linked
// accounts that newly lost paid access; `public.membership_loss_breaker` decides over a rolling
// 6-hour window whether that run's new loss is withheld and whether operators are alerted.
import { record, UUID } from "./membership.ts";
import { checkDatabaseContention } from "./database-contention.ts";
import { serviceRpcEndpoint } from "./boosty-credential.ts";
import type { RegionAlertConfig } from "./region-alerts.ts";
import type { SmtpMessage } from "./smtp.ts";

export type LossBreakerProvider = "patreon" | "boosty";
export type LossBreakerVerdict = { withhold: boolean; bypass: boolean; alert: boolean };
/** Reports one run's newly lost accounts under the worker lease and answers the window's verdict. */
export type LossBreaker = (token: string, accountIds: string[]) => Promise<LossBreakerVerdict>;
/** Operator alert kinds: loss withheld, or a mass loss let through by an operator allowance. */
export type MassLossAlert = "mass_loss_tripped" | "mass_loss_allowed";

/** Fails closed without a wired breaker: every new loss is withheld, nobody is alerted. */
export const WITHHOLD_ALL_NEW_LOSS: LossBreaker = async () => ({ withhold: true, bypass: false, alert: false });

/** Service-role adapter for `public.membership_loss_breaker`; a malformed reply throws, never allows loss. */
export function createLossBreakerRpc(options: { supabaseUrl: string; serviceKey: string; provider: LossBreakerProvider; fetchImplementation?: typeof fetch }): LossBreaker {
    const endpoint = serviceRpcEndpoint(options.supabaseUrl, options.serviceKey, "membership_loss_breaker");
    return async (token, accountIds) => {
        if (!accountIds.every(id => UUID.test(id))) throw new Error("invalid_loss_breaker_accounts");
        const response = await (options.fetchImplementation ?? fetch)(endpoint, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
            headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json" },
            body: JSON.stringify({ p_provider: options.provider, p_token: token, p_accounts: accountIds }),
        });
        if (!response.ok) { await checkDatabaseContention(response); throw new Error("loss_breaker_rpc_failed"); }
        const value: unknown = await response.json();
        if (!record(value) || typeof value.withhold !== "boolean" || typeof value.bypass !== "boolean" || typeof value.alert !== "boolean") throw new Error("invalid_loss_breaker_reply");
        return { withhold: value.withhold, bypass: value.bypass, alert: value.alert };
    };
}

/** Builds the fixed operator email for a mass-loss trip; no account data is included. */
export function massLossAlertMessage(provider: LossBreakerProvider, kind: MassLossAlert, config: Pick<RegionAlertConfig, "from" | "fromName" | "recipients">): SmtpMessage {
    const name = provider === "patreon" ? "Patreon" : "Boosty";
    const outcome = kind === "mass_loss_allowed"
        ? "An operator allowance is active, so the loss WAS written and grace is starting. Confirm the allowance in public.membership_loss_breakers is still intended."
        : `No new loss was written from the run that tripped it; other evidence, including renewals, was. Check ${name} for an outage or policy change. If the losses are real, allow them as described in docs/subscription-expiry-evidence.md.`;
    return {
        from: config.from, ...(config.fromName === undefined ? {} : { fromName: config.fromName }), to: [...config.recipients],
        subject: `[BannerlordCoop] ${name} mass membership loss ${kind === "mass_loss_allowed" ? "allowed" : "withheld"}`,
        text: `More than 25% of the linked ${name} members newly lost paid access within 6 hours. ${outcome}`,
    };
}
