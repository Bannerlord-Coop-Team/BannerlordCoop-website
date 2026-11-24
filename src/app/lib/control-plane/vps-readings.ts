import type { HostingAdminVpsAvailableHost, HostingAdminVpsInventory } from "./types";
import { failedVpsProviderReadsMessage } from "./vps-providers";

/** A live-telemetry reading, tied to the registered inventory it was read for. */
export type LiveInventoryReading = { initial: HostingAdminVpsInventory; result?: HostingAdminVpsInventory; error?: string };

/** A supplementary reading (billing, Oracle): its last result and error, never reset by a refreshed inventory. */
export type SupplementaryReading<T> = { result?: T; error?: string };

/** What a reading hook shows: its result (if any), its last error, and whether its first read is still loading. */
export type ReadingView<T> = { result?: T; error?: string; pending: boolean };

/** Whether the registered inventory arrived without live data, so its readings load before they show anything. */
export function awaitsLiveData(initial: HostingAdminVpsInventory): boolean {
    return initial.liveDataIncluded === false;
}

/** Shows the live reading for exactly this inventory, else the inventory itself when it already carries live data. */
export function liveInventoryView(reading: LiveInventoryReading | undefined, initial: HostingAdminVpsInventory): ReadingView<HostingAdminVpsInventory> {
    const current = reading?.initial === initial ? reading : undefined;
    const awaiting = awaitsLiveData(initial);
    const inventoryFallback = awaiting ? undefined : initial;
    return {
        result: current?.result ?? inventoryFallback,
        error: current?.error,
        pending: awaiting && current === undefined,
    };
}

/** Records a failed live read, keeping only a result that was read for this same inventory. */
export function failedLiveInventoryReading(previous: LiveInventoryReading | undefined, initial: HostingAdminVpsInventory, error: string): LiveInventoryReading {
    return { initial, result: previous?.initial === initial ? previous.result : undefined, error };
}

/** Shows the last supplementary result (a null result included), else `seed`; pending only before the first read settles. */
export function supplementaryView<T>(reading: SupplementaryReading<T> | undefined, seed: T | undefined, awaitingLiveData: boolean): ReadingView<T> {
    return {
        result: reading?.result !== undefined ? reading.result : seed,
        error: reading?.error,
        pending: reading === undefined && awaitingLiveData,
    };
}

/** Records a failed supplementary read, keeping its last result. */
export function failedSupplementaryReading<T>(previous: SupplementaryReading<T> | undefined, error: string): SupplementaryReading<T> {
    return { result: previous?.result, error };
}

/** Why a `vps-hosts` response's live-data flag contradicts the request, naming which way; null when it matches. */
export function liveDataMismatchError(result: Pick<HostingAdminVpsInventory, "liveDataIncluded">, includeLiveData: boolean): string | null {
    if (result.liveDataIncluded === includeLiveData) return null;
    if (includeLiveData) return "Live VPS data is unavailable.";
    return "The provider inventory read returned an unexpected live-data response.";
}

/** Why a provider-inventory `vps-hosts` response cannot be offered for onboarding: it lists no host array; null when it does or was not asked to. */
export function unlistedHostsError(result: Pick<HostingAdminVpsInventory, "availableHosts">, includeProviderInventory: boolean): string | null {
    if (!includeProviderInventory || Array.isArray(result.availableHosts)) return null;
    return "The provider account inventory response did not list hosts.";
}

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
    // Settled with no result means the first read failed, so its error is always set.
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
