"use client";

import { useCallback, useState } from "react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { usePolling, type ReadingOutcome, type ReadingSpec } from "@/app/lib/use-polling";
import { readSupabaseAccessToken } from "@/app/lib/supabase/access-token";
import {
    awaitsLiveData,
    failedLiveInventoryReading,
    failedSupplementaryReading,
    liveDataMismatchError,
    liveInventoryView,
    supplementaryView,
    type LiveInventoryReading,
    type ReadingView,
    type SupplementaryReading,
} from "@/app/lib/control-plane/vps-readings";
import type { HostingAdminHostResources, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";

/** A supplementary reading's spec plus the value a complete registered inventory already carries for it. */
export type SupplementarySpec<T> = ReadingSpec<T> & { seed: (initial: HostingAdminVpsInventory) => T };

/** A reading hook's view plus a control that reads again now. */
export type PolledReading<T> = ReadingView<T> & { refreshReadings: () => void };

/** Looks up the current access token, or null when signed out. */
export type AccessTokenLookup = () => Promise<string | null>;

/** Adapts a token-taking request into a reading: looks up the token, sends nothing if aborted meanwhile, and fails when signed out. */
export function withAccessToken<T>(lookup: AccessTokenLookup, request: (accessToken: string, signal: AbortSignal) => Promise<T>) {
    return async (signal: AbortSignal): Promise<T> => {
        const accessToken = await lookup();
        // A poll cancelled during the lookup sends no request; the poller discards this rejection.
        if (signal.aborted) throw new Error("The read was cancelled.");
        if (!accessToken) throw new Error("Authentication is required.");
        return request(accessToken, signal);
    };
}

/** Fleet telemetry and runner state for every registered host, polled every fifteen seconds. */
export const RESOURCES_READING: ReadingSpec<HostingAdminVpsInventory> = {
    interval: 15_000,
    read: withAccessToken(readSupabaseAccessToken, (accessToken, signal) => readVpsHosts(accessToken, signal, { includeLiveData: true, includeProviderInventory: false })),
};

/** Provider billing and account inventory, polled every minute beside the registered hosts. */
export const BILLING_READING: SupplementarySpec<HostingAdminVpsInventory> = {
    interval: 60_000,
    timeout: { milliseconds: 15_000, message: "Billing readings timed out." },
    read: withAccessToken(readSupabaseAccessToken, (accessToken, signal) => readVpsHosts(accessToken, signal, { includeLiveData: false, includeProviderInventory: true })),
    seed: (initial) => initial,
};

/** The Oracle control-plane host's own resources, polled every five seconds. */
export const ORACLE_READING: SupplementarySpec<HostingAdminHostResources | null> = {
    interval: 5_000,
    timeout: { milliseconds: 10_000, message: "Oracle readings timed out." },
    read: withAccessToken(readSupabaseAccessToken, (accessToken, signal) => requestControlPlaneAdmin<HostingAdminHostResources | null>({ accessToken, operation: "control-plane-host-resources", signal })),
    seed: (initial) => initial.controlPlaneHost,
};

/** The registered inventory with live telemetry; a refreshed inventory resets it, so newly registered hosts show at once. */
export function useLiveInventoryReading(initialInventory: HostingAdminVpsInventory, spec: ReadingSpec<HostingAdminVpsInventory> = RESOURCES_READING): PolledReading<HostingAdminVpsInventory> {
    const [reading, setReading] = useState<LiveInventoryReading>();
    const settle = useCallback((outcome: ReadingOutcome<HostingAdminVpsInventory>) => setReading((previous) => {
        if (!outcome.ok) return failedLiveInventoryReading(previous, initialInventory, outcome.error);
        return { initial: initialInventory, result: outcome.result };
    }), [initialInventory]);
    const schedule = { readImmediately: awaitsLiveData(initialInventory), restartKey: initialInventory };
    const refreshReadings = usePolling(spec, settle, schedule);
    return { ...liveInventoryView(reading, initialInventory), refreshReadings };
}

/** A billing or Oracle reading polled beside the inventory: it reads again when the inventory refreshes but keeps its last result. */
export function useSupplementaryReading<T>(initialInventory: HostingAdminVpsInventory, spec: SupplementarySpec<T>): PolledReading<T> {
    const [reading, setReading] = useState<SupplementaryReading<T>>();
    const settle = useCallback((outcome: ReadingOutcome<T>) => setReading((previous) => {
        if (!outcome.ok) return failedSupplementaryReading(previous, outcome.error);
        return { result: outcome.result };
    }), []);
    const awaitingLiveData = awaitsLiveData(initialInventory);
    const refreshReadings = usePolling(spec, settle, { readImmediately: awaitingLiveData, restartKey: initialInventory });
    const seed = awaitingLiveData ? undefined : spec.seed(initialInventory);
    return { ...supplementaryView(reading, seed, awaitingLiveData), refreshReadings };
}

/** Reads `vps-hosts` and rejects a response whose live-data flag contradicts the request. */
async function readVpsHosts(accessToken: string, signal: AbortSignal, input: { includeLiveData: boolean; includeProviderInventory: boolean }) {
    const result = await requestControlPlaneAdmin<HostingAdminVpsInventory>({ accessToken, operation: "vps-hosts", input, signal });
    const mismatch = liveDataMismatchError(result, input.includeLiveData);
    if (mismatch !== null) throw new Error(mismatch);
    return result;
}
