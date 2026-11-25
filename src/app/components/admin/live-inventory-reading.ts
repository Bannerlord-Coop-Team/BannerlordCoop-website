import { awaitsLiveData } from "@/app/lib/control-plane/vps-readings";
import type { HostingAdminVpsInventory } from "@/app/lib/control-plane/types";
import type { ReadingView } from "@/app/lib/reading-state";

/** A live-telemetry reading, tied to the registered inventory it was read for. */
export type LiveInventoryReading = { initial: HostingAdminVpsInventory; result?: HostingAdminVpsInventory; error?: string };

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
