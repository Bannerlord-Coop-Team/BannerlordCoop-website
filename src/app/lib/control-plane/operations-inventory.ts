import { ControlPlaneAdminError } from "./client";
import type { HostingAdminVpsInventory } from "./types";
import { failedVpsProviderReadsMessage } from "./vps-providers";

export type VpsInventoryOptions = { includeLiveData: false; includeProviderInventory: "service-names" | false };

/** Reads Operations VPS inventory, reporting failed provider account reads and falling back to local hosts when the read fails. */
export async function readOperationsVpsInventory(
    read: (input: VpsInventoryOptions) => Promise<HostingAdminVpsInventory>,
): Promise<{ inventory: HostingAdminVpsInventory; providerError: string | null }> {
    try {
        const inventory = await read({ includeLiveData: false, includeProviderInventory: "service-names" });
        return { inventory, providerError: failedVpsProviderReadsMessage(inventory.providerReads) };
    } catch (cause) {
        const inventory = await read({ includeLiveData: false, includeProviderInventory: false });
        const reason = cause instanceof ControlPlaneAdminError ? cause.message : "The provider account inventory could not be read.";
        return { inventory, providerError: reason };
    }
}
