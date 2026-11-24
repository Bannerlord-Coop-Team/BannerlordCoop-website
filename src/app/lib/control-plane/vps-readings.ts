import type { HostingAdminVpsInventory } from "./types";
import { failedVpsProviderReadsMessage } from "./vps-providers";

/** A live-telemetry reading, tied to the registered inventory it was read for. */
export type LiveInventoryReading = { initial: HostingAdminVpsInventory; result?: HostingAdminVpsInventory; error?: string };

/** A supplementary reading (billing, Oracle): its last result and error, never reset by a refreshed inventory. */
export type SupplementaryReading<T> = { result?: T; error?: string };

/** What a reading hook shows: its result (if any), its last error, and whether its first read is still loading. */
export type ReadingView<T> = { result?: T; error?: string; pending: boolean };

/** A deadline that bounds one slow read, and the message shown when it passes. */
export type ReadingTimeout = { milliseconds: number; message: string };

/** Whether the registered inventory arrived without live data, so its readings load before they show anything. */
export function awaitsLiveData(initial: HostingAdminVpsInventory): boolean {
    return initial.liveDataIncluded === false;
}

/** Shows the live reading for exactly this inventory, else the inventory itself when it already carries live data. */
export function liveInventoryView(reading: LiveInventoryReading | undefined, initial: HostingAdminVpsInventory): ReadingView<HostingAdminVpsInventory> {
    const current = reading?.initial === initial ? reading : undefined;
    const inventoryFallback = awaitsLiveData(initial) ? undefined : initial;
    return {
        result: current?.result ?? inventoryFallback,
        error: current?.error,
        pending: awaitsLiveData(initial) && current === undefined,
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

/** The message a failed read shows: its timeout's when the deadline passed, else the error's own, else a generic one. */
export function readingErrorMessage(error: unknown, timedOut: boolean, timeout: ReadingTimeout | undefined): string {
    if (timedOut && timeout !== undefined) return timeout.message;
    if (error instanceof Error) return error.message;
    return "VPS readings could not be loaded.";
}

/** Why a `vps-hosts` response's live-data flag contradicts the request, naming which way; null when it matches. */
export function liveDataMismatchError(result: Pick<HostingAdminVpsInventory, "liveDataIncluded">, includeLiveData: boolean): string | null {
    if (result.liveDataIncluded === includeLiveData) return null;
    if (includeLiveData) return "Live VPS data is unavailable.";
    return "The provider inventory read returned an unexpected live-data response.";
}

/** The billing reading's condition, in precedence order: loading, failed with nothing to show, stale, some provider accounts failed, or ok. */
export type BillingReadState =
    | { kind: "loading" }
    | { kind: "failed"; error: string }
    | { kind: "stale"; error: string }
    | { kind: "partial"; failedProviderReads: string }
    | { kind: "ok" };

/** Classifies the billing reading so the page banners and the provider form apply one precedence. */
export function billingReadState(billing: ReadingView<HostingAdminVpsInventory>): BillingReadState {
    if (billing.pending) return { kind: "loading" };
    if (billing.error !== undefined && billing.result === undefined) return { kind: "failed", error: billing.error };
    if (billing.error !== undefined) return { kind: "stale", error: billing.error };
    const failedProviderReads = failedVpsProviderReadsMessage(billing.result?.providerReads);
    if (failedProviderReads !== null) return { kind: "partial", failedProviderReads };
    return { kind: "ok" };
}
