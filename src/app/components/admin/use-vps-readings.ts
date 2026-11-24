"use client";

import { useCallback, useState } from "react";
import { usePolling, type PollingSchedule, type ReadingOutcome, type ReadingSpec } from "@/app/lib/use-polling";
import {
    awaitsLiveData,
    failedLiveInventoryReading,
    failedSupplementaryReading,
    liveInventoryView,
    supplementaryView,
    type LiveInventoryReading,
    type ReadingView,
    type SupplementaryReading,
} from "@/app/lib/control-plane/vps-readings";
import type { HostingAdminVpsInventory } from "@/app/lib/control-plane/types";

/** A supplementary reading's spec plus the value a complete registered inventory already carries for it. */
export type SupplementarySpec<T> = ReadingSpec<T> & { seed: (initial: HostingAdminVpsInventory) => T };

/** A reading hook's view plus a control that reads again now. */
export type PolledReading<T> = ReadingView<T> & { refreshReadings: () => void };

/** A reading's polling schedule: at once when the inventory awaits live data, restarting whenever the server sends a new one. */
function inventoryPollingSchedule(initial: HostingAdminVpsInventory): PollingSchedule {
    return { readImmediately: awaitsLiveData(initial), restartKey: initial };
}

/** The registered inventory with live telemetry; a refreshed inventory resets it, so newly registered hosts show at once. */
export function useLiveInventoryReading(initialInventory: HostingAdminVpsInventory, spec: ReadingSpec<HostingAdminVpsInventory>): PolledReading<HostingAdminVpsInventory> {
    const [reading, setReading] = useState<LiveInventoryReading>();
    const settle = useCallback((outcome: ReadingOutcome<HostingAdminVpsInventory>) => setReading((previous) => {
        if (!outcome.ok) return failedLiveInventoryReading(previous, initialInventory, outcome.error);
        return { initial: initialInventory, result: outcome.result };
    }), [initialInventory]);
    const refreshReadings = usePolling(spec, settle, inventoryPollingSchedule(initialInventory));
    return { ...liveInventoryView(reading, initialInventory), refreshReadings };
}

/** A billing or Oracle reading polled beside the inventory: it reads again when the inventory refreshes but keeps its last result. */
export function useSupplementaryReading<T>(initialInventory: HostingAdminVpsInventory, spec: SupplementarySpec<T>): PolledReading<T> {
    const [reading, setReading] = useState<SupplementaryReading<T>>();
    const settle = useCallback((outcome: ReadingOutcome<T>) => setReading((previous) => {
        if (!outcome.ok) return failedSupplementaryReading(previous, outcome.error);
        return { result: outcome.result };
    }), []);
    const refreshReadings = usePolling(spec, settle, inventoryPollingSchedule(initialInventory));
    const awaitingLiveData = awaitsLiveData(initialInventory);
    const seed = awaitingLiveData ? undefined : spec.seed(initialInventory);
    return { ...supplementaryView(reading, seed, awaitingLiveData), refreshReadings };
}
