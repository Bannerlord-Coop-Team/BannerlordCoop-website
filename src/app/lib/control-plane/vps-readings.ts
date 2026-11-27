import type { HostingAdminVpsInventory } from "./types";

/** Whether the registered inventory arrived without live data, so its readings load before they show anything. */
export function awaitsLiveData(initial: HostingAdminVpsInventory): boolean {
    return initial.liveDataIncluded === false;
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
