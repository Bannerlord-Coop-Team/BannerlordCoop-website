import { ControlPlaneAdminError } from "./client";
import type { HostingAdminVpsInventory } from "./types";

export type VpsInventoryOptions = { includeLiveData: false; includeProviderInventory: "service-names" | false };

/** Reads Operations VPS inventory, falling back to local hosts when the OVH account read fails. */
export async function readOperationsVpsInventory(
    read: (input: VpsInventoryOptions) => Promise<HostingAdminVpsInventory>,
): Promise<{ inventory: HostingAdminVpsInventory; providerError: string | null }> {
    try {
        return { inventory: await read({ includeLiveData: false, includeProviderInventory: "service-names" }), providerError: null };
    } catch (cause) {
        const inventory = await read({ includeLiveData: false, includeProviderInventory: false });
        const reason = cause instanceof ControlPlaneAdminError ? cause.message : "The OVH account inventory could not be read.";
        return { inventory, providerError: reason };
    }
}
