// Mass-reclassification breaker shared by the Patreon and Boosty workers: a run in which too many
// linked members newly lose paid access writes no loss, keeps their evidence and alerts operators.
import { record } from "./membership.ts";
import { checkDatabaseContention } from "./database-contention.ts";
import { serviceRpcEndpoint } from "./boosty-credential.ts";
import type { RegionAlertConfig } from "./region-alerts.ts";
import type { SmtpMessage } from "./smtp.ts";

/** Trips above this share of the linked members a run read. */
export const MASS_LOSS_FRACTION = 0.25;
/** Runs reading fewer linked members never trip, so one real loss in a small run is written. */
export const MASS_LOSS_MINIMUM_SAMPLE = 10;
export type LossBreakerProvider = "patreon" | "boosty";
/** Records a trip under the worker lease: `bypass` while an operator allows loss, `alert` at most every 6 hours. */
export type LossBreaker = (token: string) => Promise<{ bypass: boolean; alert: boolean }>;

/** Decides a trip from one run's counts of newly lost and read linked members. */
export function massLossTripped(newlyLost: number, read: number): boolean {
    return read >= MASS_LOSS_MINIMUM_SAMPLE && newlyLost > read * MASS_LOSS_FRACTION;
}

/** Service-role adapter for `public.membership_loss_breaker`; a malformed reply throws, never bypasses. */
export function createLossBreakerRpc(options: { supabaseUrl: string; serviceKey: string; provider: LossBreakerProvider; fetchImplementation?: typeof fetch }): LossBreaker {
    const endpoint = serviceRpcEndpoint(options.supabaseUrl, options.serviceKey, "membership_loss_breaker");
    return async token => {
        const response = await (options.fetchImplementation ?? fetch)(endpoint, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
            headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json" },
            body: JSON.stringify({ p_provider: options.provider, p_token: token }),
        });
        if (!response.ok) { await checkDatabaseContention(response); throw new Error("loss_breaker_rpc_failed"); }
        const value: unknown = await response.json();
        if (!record(value) || typeof value.bypass !== "boolean" || typeof value.alert !== "boolean") throw new Error("invalid_loss_breaker_reply");
        return { bypass: value.bypass, alert: value.alert };
    };
}

/** Builds the fixed operator email for a mass-loss trip; no account data is included. */
export function massLossAlertMessage(provider: LossBreakerProvider, config: Pick<RegionAlertConfig, "from" | "fromName" | "recipients">): SmtpMessage {
    const name = provider === "patreon" ? "Patreon" : "Boosty";
    return {
        from: config.from, ...(config.fromName === undefined ? {} : { fromName: config.fromName }), to: [...config.recipients],
        subject: `[BannerlordCoop] ${name} mass membership loss withheld`,
        text: `More than ${MASS_LOSS_FRACTION * 100}% of the linked ${name} members read in one run newly lost paid access, so no loss was written from it; other evidence, including renewals, was. Check ${name} for an outage or policy change. If the losses are real, allow them as described in docs/subscription-expiry-evidence.md.`,
    };
}
