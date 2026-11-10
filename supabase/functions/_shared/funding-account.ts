// Provider-keyed website-account operations. Each funding provider contributes one surface; the
// website-account handler dispatches status/start/unlink through it without provider branches.
import { FUNDING_PROVIDERS, type FundingProvider } from "./funding-provider.ts";

/** The account actions a funding provider may offer. */
export const FUNDING_ACCOUNT_ACTIONS = ["status", "start", "unlink"] as const;
export type FundingAccountAction = typeof FUNDING_ACCOUNT_ACTIONS[number];
/** Runs one action for the authenticated account; null means the body is not a valid request for it. */
export type FundingAccountOperation = (body: Record<string, unknown>) => Promise<Response | null>;
/** One provider's account actions, by action. */
export type FundingAccountSurface = { readonly operations: Partial<Record<FundingAccountAction, FundingAccountOperation>> };
// Patreon's operations predate other providers and keep their unprefixed wire names; the single exception.
const UNPREFIXED_PROVIDER: FundingProvider = "patreon";

/** The wire operation name of one provider action: `<provider>-<action>`, or the bare action for Patreon. */
export function fundingAccountOperationName(provider: FundingProvider, action: FundingAccountAction): string {
    return provider === UNPREFIXED_PROVIDER ? action : `${provider}-${action}`;
}

/** Finds the provider operation a request names in provider then action order, or null when it names none. */
export function fundingAccountOperation(surfaces: Record<FundingProvider, FundingAccountSurface>, operation: unknown): FundingAccountOperation | null {
    if (typeof operation !== "string") return null;
    for (const provider of FUNDING_PROVIDERS) {
        for (const action of FUNDING_ACCOUNT_ACTIONS) {
            const run = surfaces[provider].operations[action];
            if (run !== undefined && operation === fundingAccountOperationName(provider, action)) return run;
        }
    }
    return null;
}
