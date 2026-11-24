"use client";

import { useCallback, useEffect, useState } from "react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import {
    awaitsLiveData,
    failedLiveInventoryReading,
    failedSupplementaryReading,
    liveInventoryView,
    readingErrorMessage,
    supplementaryView,
    type LiveInventoryReading,
    type ReadingTimeout,
    type ReadingView,
    type SupplementaryReading,
} from "@/app/lib/control-plane/vps-readings";
import type { HostingAdminHostResources, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";

/** How one reading is fetched and how often; `timeout` bounds a slow read with its own message. */
export type ReadingSpec<T> = {
    interval: number;
    timeout?: ReadingTimeout;
    read: (accessToken: string, signal: AbortSignal) => Promise<T>;
};

/** A supplementary reading's spec plus the value a complete registered inventory already carries for it. */
export type SupplementarySpec<T> = ReadingSpec<T> & { seed: (initial: HostingAdminVpsInventory) => T };

/** One read's outcome, handed to the hook that owns the reading's state. */
export type ReadingOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

/** A reading hook's view plus a control that reads again now. */
export type PolledReading<T> = ReadingView<T> & { refreshReadings: () => void };

/** Looks up the current access token, or null when signed out. */
export type AccessTokenLookup = () => Promise<string | null>;

const RESOURCES_READING: ReadingSpec<HostingAdminVpsInventory> = {
    interval: 15_000,
    read: (accessToken, signal) => readVpsHosts(accessToken, signal, { includeLiveData: true, includeProviderInventory: false }),
};

/** Provider billing and account inventory, polled every minute beside the registered hosts. */
export const BILLING_READING: SupplementarySpec<HostingAdminVpsInventory> = {
    interval: 60_000,
    timeout: { milliseconds: 15_000, message: "Billing readings timed out." },
    read: (accessToken, signal) => readVpsHosts(accessToken, signal, { includeLiveData: false, includeProviderInventory: true }),
    seed: (initial) => initial,
};

/** The Oracle control-plane host's own resources, polled every five seconds. */
export const ORACLE_READING: SupplementarySpec<HostingAdminHostResources | null> = {
    interval: 5_000,
    timeout: { milliseconds: 10_000, message: "Oracle readings timed out." },
    read: (accessToken, signal) => requestControlPlaneAdmin<HostingAdminHostResources | null>({ accessToken, operation: "control-plane-host-resources", signal }),
    seed: (initial) => initial.controlPlaneHost,
};

/** The registered inventory with live telemetry; a refreshed inventory resets it, so newly registered hosts show at once. */
export function useLiveInventoryReading(initialInventory: HostingAdminVpsInventory): PolledReading<HostingAdminVpsInventory> {
    const [reading, setReading] = useState<LiveInventoryReading>();
    const settle = useCallback((outcome: ReadingOutcome<HostingAdminVpsInventory>) => setReading((previous) => {
        if (!outcome.ok) return failedLiveInventoryReading(previous, initialInventory, outcome.error);
        return { initial: initialInventory, result: outcome.result };
    }), [initialInventory]);
    const refreshReadings = usePolling(initialInventory, RESOURCES_READING, settle);
    return { ...liveInventoryView(reading, initialInventory), refreshReadings };
}

/** A billing or Oracle reading polled beside the inventory: it reads again when the inventory refreshes but keeps its last result. */
export function useSupplementaryReading<T>(initialInventory: HostingAdminVpsInventory, spec: SupplementarySpec<T>): PolledReading<T> {
    const [reading, setReading] = useState<SupplementaryReading<T>>();
    const settle = useCallback((outcome: ReadingOutcome<T>) => setReading((previous) => {
        if (!outcome.ok) return failedSupplementaryReading(previous, outcome.error);
        return { result: outcome.result };
    }), []);
    const refreshReadings = usePolling(initialInventory, spec, settle);
    const awaitingLiveData = awaitsLiveData(initialInventory);
    const seed = awaitingLiveData ? undefined : spec.seed(initialInventory);
    return { ...supplementaryView(reading, seed, awaitingLiveData), refreshReadings };
}

/** Polls one reading: at once when the inventory lacks live data or on retry, else after one interval; pauses while hidden, aborts on unmount. */
export function usePolling<T>(initialInventory: HostingAdminVpsInventory, spec: ReadingSpec<T>, settle: (outcome: ReadingOutcome<T>) => void,
    readAccessToken: AccessTokenLookup = readSupabaseAccessToken) {
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
                const accessToken = await readAccessToken();
                if (cancelled) return;
                if (!accessToken) throw new Error("Authentication is required.");
                const result = await spec.read(accessToken, AbortSignal.any([controller.signal, requestController.signal]));
                if (!cancelled) settle({ ok: true, result });
            } catch (error) {
                if (!cancelled) settle({ ok: false, error: readingErrorMessage(error, requestController.signal.aborted, spec.timeout) });
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
    }, [initialInventory, attempt, spec, settle, readAccessToken]);
    return refreshReadings;
}

/** The signed-in Supabase session's access token, or null when there is none. */
async function readSupabaseAccessToken(): Promise<string | null> {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    return session?.access_token ?? null;
}

/** Reads `vps-hosts` and rejects a response whose live-data flag does not match what was asked for, naming which way it differs. */
async function readVpsHosts(accessToken: string, signal: AbortSignal, input: { includeLiveData: boolean; includeProviderInventory: boolean }) {
    const result = await requestControlPlaneAdmin<HostingAdminVpsInventory>({ accessToken, operation: "vps-hosts", input, signal });
    if (result.liveDataIncluded === input.includeLiveData) return result;
    if (input.includeLiveData) throw new Error("Live VPS data is unavailable.");
    throw new Error("The provider inventory read returned an unexpected live-data response.");
}
