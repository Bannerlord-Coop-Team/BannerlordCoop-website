"use client";

import { useCallback, useEffect, useState } from "react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
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
import type { HostingAdminHostResources, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";

/** How one reading is fetched and how often; `timeout` bounds a slow read with its own message. */
type ReadingSpec<T> = {
    interval: number;
    timeout?: { milliseconds: number; message: string };
    read: (accessToken: string, signal: AbortSignal) => Promise<T>;
};

/** A supplementary reading's spec plus the value a complete registered inventory already carries for it. */
type SupplementarySpec<T> = ReadingSpec<T> & { seed: (initial: HostingAdminVpsInventory) => T };

type ReadingOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

/** A reading hook's view plus a control that reads again now. */
export type PolledReading<T> = ReadingView<T> & { refreshReadings: () => void };

const RESOURCES: ReadingSpec<HostingAdminVpsInventory> = {
    interval: 15_000,
    read: (accessToken, signal) => readVpsHosts(accessToken, signal, { includeLiveData: true, includeProviderInventory: false }),
};

const SUPPLEMENTARY = {
    billing: {
        interval: 60_000,
        timeout: { milliseconds: 15_000, message: "Billing readings timed out." },
        read: (accessToken, signal) => readVpsHosts(accessToken, signal, { includeLiveData: false, includeProviderInventory: true }),
        seed: (initial) => initial,
    } satisfies SupplementarySpec<HostingAdminVpsInventory>,
    oracle: {
        interval: 5_000,
        timeout: { milliseconds: 10_000, message: "Oracle readings timed out." },
        read: (accessToken, signal) => requestControlPlaneAdmin<HostingAdminHostResources | null>({ accessToken, operation: "control-plane-host-resources", signal }),
        seed: (initial) => initial.controlPlaneHost,
    } satisfies SupplementarySpec<HostingAdminHostResources | null>,
};

type SupplementaryKind = keyof typeof SUPPLEMENTARY;
type SupplementaryResult<K extends SupplementaryKind> = Awaited<ReturnType<(typeof SUPPLEMENTARY)[K]["read"]>>;

/** The registered inventory with live telemetry; a refreshed inventory resets it, so newly registered hosts show at once. */
export function useLiveInventoryReading(initialInventory: HostingAdminVpsInventory): PolledReading<HostingAdminVpsInventory> {
    const [reading, setReading] = useState<LiveInventoryReading>();
    const settle = useCallback((outcome: ReadingOutcome<HostingAdminVpsInventory>) => setReading((previous) => outcome.ok
        ? { initial: initialInventory, result: outcome.result }
        : failedLiveInventoryReading(previous, initialInventory, outcome.error)), [initialInventory]);
    const refreshReadings = usePolling(initialInventory, RESOURCES, settle);
    return { ...liveInventoryView(reading, initialInventory), refreshReadings };
}

/** A billing or Oracle reading polled beside the inventory: it reads again when the inventory refreshes but keeps its last result. */
export function useSupplementaryReading<K extends SupplementaryKind>(initialInventory: HostingAdminVpsInventory, kind: K): PolledReading<SupplementaryResult<K>> {
    const spec = SUPPLEMENTARY[kind] as unknown as SupplementarySpec<SupplementaryResult<K>>;
    const [reading, setReading] = useState<SupplementaryReading<SupplementaryResult<K>>>();
    const settle = useCallback((outcome: ReadingOutcome<SupplementaryResult<K>>) => setReading((previous) => outcome.ok
        ? { result: outcome.result }
        : failedSupplementaryReading(previous, outcome.error)), []);
    const refreshReadings = usePolling(initialInventory, spec, settle);
    const seed = awaitsLiveData(initialInventory) ? undefined : spec.seed(initialInventory);
    return { ...supplementaryView(reading, seed, initialInventory), refreshReadings };
}

/** Polls one reading: at once when the inventory lacks live data or on retry, else after one interval; pauses while hidden, aborts on unmount. */
function usePolling<T>(initialInventory: HostingAdminVpsInventory, spec: ReadingSpec<T>, settle: (outcome: ReadingOutcome<T>) => void) {
    const [attempt, setAttempt] = useState(0);
    const refreshReadings = useCallback(() => setAttempt((value) => value + 1), []);
    useEffect(() => {
        let cancelled = false;
        let inFlight = false;
        let timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController();
        /** Runs one bounded read, settles its outcome unless cancelled, and schedules the next. */
        async function load() {
            if (cancelled || inFlight || document.visibilityState === "hidden") return;
            clearTimeout(timer);
            inFlight = true;
            const requestController = new AbortController();
            const deadline = spec.timeout === undefined ? undefined : setTimeout(() => requestController.abort(), spec.timeout.milliseconds);
            try {
                const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
                if (cancelled) return;
                if (!session?.access_token) throw new Error("Authentication is required.");
                const result = await spec.read(session.access_token, AbortSignal.any([controller.signal, requestController.signal]));
                if (!cancelled) settle({ ok: true, result });
            } catch (error) {
                if (!cancelled) settle({ ok: false, error: requestController.signal.aborted && spec.timeout !== undefined ? spec.timeout.message
                    : error instanceof Error ? error.message : "VPS readings could not be loaded." });
            } finally {
                clearTimeout(deadline);
                inFlight = false;
                if (!cancelled) timer = setTimeout(() => void load(), spec.interval);
            }
        }
        /** Pauses polling while the tab is hidden and reads at once when it returns. */
        function visibilityChanged() {
            clearTimeout(timer);
            if (document.visibilityState !== "hidden") void load();
        }
        if (awaitsLiveData(initialInventory) || attempt > 0) void load();
        else timer = setTimeout(() => void load(), spec.interval);
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            controller.abort();
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, [initialInventory, attempt, spec, settle]);
    return refreshReadings;
}

/** Reads `vps-hosts` and rejects a response whose live-data flag does not match what was asked for. */
async function readVpsHosts(accessToken: string, signal: AbortSignal, input: { includeLiveData: boolean; includeProviderInventory: boolean }) {
    const result = await requestControlPlaneAdmin<HostingAdminVpsInventory>({ accessToken, operation: "vps-hosts", input, signal });
    if (result.liveDataIncluded !== input.includeLiveData) throw new Error("Live VPS data is unavailable.");
    return result;
}
