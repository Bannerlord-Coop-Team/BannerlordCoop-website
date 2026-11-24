"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { readingErrorMessage, type ReadingTimeout } from "@/app/lib/control-plane/vps-readings";

/** How one reading is fetched and how often; `timeout` bounds a slow read with its own message. */
export type ReadingSpec<T> = {
    interval: number;
    timeout?: ReadingTimeout;
    read: (accessToken: string, signal: AbortSignal) => Promise<T>;
};

/** One read's outcome, handed to the hook that owns the reading's state. */
export type ReadingOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

/** Looks up the current access token, or null when signed out. */
export type AccessTokenLookup = () => Promise<string | null>;

/** When polling starts: at once or after one interval, restarting whenever `restartKey` changes. */
export type PollingSchedule = { readImmediately: boolean; restartKey: unknown };

/** Polls `spec.read`: at once when asked or on retry, else after one interval; pauses while hidden, aborts on unmount. Returns a retry control. */
export function usePolling<T>(spec: ReadingSpec<T>, settle: (outcome: ReadingOutcome<T>) => void, { readImmediately, restartKey }: PollingSchedule,
    readAccessToken: AccessTokenLookup = readSupabaseAccessToken) {
    const [attempt, setAttempt] = useState(0);
    const specRef = useRef(spec);
    useLayoutEffect(() => { specRef.current = spec; }, [spec]);
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
            const outcome = await readWithinDeadline(specRef.current, readAccessToken, controller.signal);
            inFlight = false;
            if (cancelled) return;
            settle(outcome);
            timer = setTimeout(() => void load(), specRef.current.interval);
        }
        /** Pauses polling while the tab is hidden and reads at once when it returns. */
        function visibilityChanged() {
            clearTimeout(timer);
            if (document.visibilityState !== "hidden") void load();
        }
        if (readImmediately || attempt > 0) void load();
        else timer = setTimeout(() => void load(), specRef.current.interval);
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            controller.abort();
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, [restartKey, readImmediately, attempt, settle, readAccessToken]);
    return refreshReadings;
}

/** Reads once with a fresh token under `signal` plus the spec's deadline, turning any failure into a reading outcome. */
async function readWithinDeadline<T>(spec: ReadingSpec<T>, readAccessToken: AccessTokenLookup, signal: AbortSignal): Promise<ReadingOutcome<T>> {
    const deadlineController = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    if (spec.timeout !== undefined) deadline = setTimeout(() => deadlineController.abort(), spec.timeout.milliseconds);
    try {
        const accessToken = await readAccessToken();
        // A poll cancelled during the token lookup sends no request; its caller discards this outcome.
        if (signal.aborted) return { ok: false, error: "The read was cancelled." };
        if (!accessToken) throw new Error("Authentication is required.");
        return { ok: true, result: await spec.read(accessToken, AbortSignal.any([signal, deadlineController.signal])) };
    } catch (error) {
        const timedOut = deadlineController.signal.aborted;
        return { ok: false, error: readingErrorMessage(error, timedOut, spec.timeout) };
    } finally {
        clearTimeout(deadline);
    }
}

/** The signed-in Supabase session's access token, or null when there is none. */
export async function readSupabaseAccessToken(): Promise<string | null> {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    return session?.access_token ?? null;
}
