import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { readRegisteredVpsInventory } from "@/app/lib/control-plane/registered-vps-inventory";
import { liveDataMismatchError, unlistedHostsError } from "@/app/lib/control-plane/vps-readings";
import type { HostingAdminHostResources, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";
import { readSupabaseAccessToken, withAccessToken } from "@/app/lib/supabase/access-token";
import type { ReadingSpec } from "@/app/lib/use-polling";
import type { SupplementarySpec } from "./use-vps-readings";

/** Fleet telemetry and runner state for every registered host, polled every fifteen seconds. */
export const RESOURCES_READING: ReadingSpec<HostingAdminVpsInventory> = {
    interval: 15_000,
    read: withAccessToken(readSupabaseAccessToken, async (accessToken, signal) => {
        const result = await readRegisteredVpsInventory((input, pageSignal) => requestControlPlaneAdmin<HostingAdminVpsInventory>({
            accessToken, operation: "vps-hosts", input, signal: pageSignal,
        }), true, signal);
        const mismatch = liveDataMismatchError(result, true);
        if (mismatch !== null) throw new Error(mismatch);
        return result;
    }),
};

/** Provider billing and account inventory, polled every minute beside the registered hosts. */
export const BILLING_READING: SupplementarySpec<HostingAdminVpsInventory> = {
    interval: 60_000,
    timeout: { milliseconds: 15_000, message: "Billing readings timed out." },
    read: withAccessToken(readSupabaseAccessToken, readVpsBilling),
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

/** Reads provider billing and requires the provider host list used by Add capacity. */
async function readVpsBilling(accessToken: string, signal: AbortSignal) {
    const input = { includeLiveData: false, includeProviderInventory: true };
    const result = await requestControlPlaneAdmin<HostingAdminVpsInventory>({ accessToken, operation: "vps-hosts", input, signal });
    const mismatch = liveDataMismatchError(result, false) ?? unlistedHostsError(result, true);
    if (mismatch !== null) throw new Error(mismatch);
    return result;
}
