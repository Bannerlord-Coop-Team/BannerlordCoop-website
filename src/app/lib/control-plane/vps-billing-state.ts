import type { HostingAdminVpsAvailableHost, HostingAdminVpsInventory } from "./types";
import { failedVpsProviderReadsMessage } from "./vps-providers";
import type { ReadingView } from "../reading-state";

/** The hosts a billing state with a result offers for onboarding. */
type ListedHosts = { availableHosts: readonly HostingAdminVpsAvailableHost[] };

/** The billing reading's condition, in precedence order: loading, failed with nothing to show, stale, some provider accounts failed, or ok; the last three carry the hosts to offer. */
export type BillingReadState =
    | { kind: "loading" }
    | { kind: "failed"; error: string }
    | ({ kind: "stale"; error: string } & ListedHosts)
    | ({ kind: "partial"; failedProviderReads: string } & ListedHosts)
    | ({ kind: "ok" } & ListedHosts);

/** Classifies the billing reading so the page banners, host count and provider form apply one precedence. */
export function billingReadState(billing: ReadingView<HostingAdminVpsInventory>): BillingReadState {
    if (billing.pending) return { kind: "loading" };
    // Settled with no result means the first read failed; the fallback only satisfies the optional `error` type.
    if (billing.result === undefined) return { kind: "failed", error: billing.error ?? "The provider account inventory could not be read." };
    // Fetched results are checked by the read; only an older backend's seeded inventory can lack the list, and it then lists none.
    const availableHosts = Array.isArray(billing.result.availableHosts) ? billing.result.availableHosts : [];
    if (billing.error !== undefined) return { kind: "stale", error: billing.error, availableHosts };
    const failedProviderReads = failedVpsProviderReadsMessage(billing.result.providerReads);
    if (failedProviderReads !== null) return { kind: "partial", failedProviderReads, availableHosts };
    return { kind: "ok", availableHosts };
}

/** The hosts a billing state offers for onboarding, or null while loading or failed. */
export function billingListedHosts(state: BillingReadState): readonly HostingAdminVpsAvailableHost[] | null {
    if (state.kind === "loading" || state.kind === "failed") return null;
    return state.availableHosts;
}
