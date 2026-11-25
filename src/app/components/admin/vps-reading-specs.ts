import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { liveDataMismatchError, unlistedHostsError } from "@/app/lib/control-plane/vps-readings";
import type { HostingAdminHostResources, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";
import { readSupabaseAccessToken, withAccessToken } from "@/app/lib/supabase/access-token";
import type { ReadingSpec } from "@/app/lib/use-polling";
import type { SupplementarySpec } from "./use-vps-readings";

/** Fleet telemetry and runner state for every registered host, polled every fifteen seconds. */
export const RESOURCES_READING: ReadingSpec<HostingAdminVpsInventory> = {
    interval: 15_000,
    read: vpsHostsRead({ includeLiveData: true, includeProviderInventory: false }),
};

/** Provider billing and account inventory, polled every minute beside the registered hosts. */
export const BILLING_READING: SupplementarySpec<HostingAdminVpsInventory> = {
    interval: 60_000,
    timeout: { milliseconds: 15_000, message: "Billing readings timed out." },
    read: vpsHostsRead({ includeLiveData: false, includeProviderInventory: true }),
    seed: (initial) => initial,
};

/** The Oracle control-plane host's own resources, polled every five seconds. */
export const ORACLE_READING: SupplementarySpec<HostingAdminHostResources | null> = {
    interval: 5_000,
    timeout: { milliseconds: 10_000, message: "Oracle readings timed out." },
    read: withAccessToken(readSupabaseAccessToken, (accessToken, signal) => requestControlPlaneAdmin<HostingAdminHostResources | null>(
        { accessToken, operation: "control-plane-host-resources", signal })),
    seed: (initial) => initial.controlPlaneHost,
};

type VpsHostsInput = { includeLiveData: boolean; includeProviderInventory: boolean };

/** A signed-in `vps-hosts` read for one input shape. */
function vpsHostsRead(input: VpsHostsInput) {
    return withAccessToken(readSupabaseAccessToken, (accessToken, signal) => readVpsHosts(accessToken, signal, input));
}

/** Reads `vps-hosts` and rejects a response whose live-data flag contradicts the request or whose requested host list is missing. */
async function readVpsHosts(accessToken: string, signal: AbortSignal, input: VpsHostsInput) {
    const result = await requestControlPlaneAdmin<HostingAdminVpsInventory>({ accessToken, operation: "vps-hosts", input, signal });
    const mismatch = liveDataMismatchError(result, input.includeLiveData) ?? unlistedHostsError(result, input.includeProviderInventory);
    if (mismatch !== null) throw new Error(mismatch);
    return result;
}
