"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A deadline that bounds one slow read, and the message shown when it passes. */
export type ReadingTimeout = { milliseconds: number; message: string };

/** How one reading is fetched and how often; `timeout` bounds a slow read with its own message. */
export type ReadingSpec<T> = {
    interval: number;
    timeout?: ReadingTimeout;
    read: (signal: AbortSignal) => Promise<T>;
};

/** One read's outcome, handed to the hook that owns the reading's state. */
export type ReadingOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

/** When polling starts: at once or after one interval, restarting whenever `restartKey` changes. */
export type PollingSchedule = { readImmediately: boolean; restartKey: unknown };

/** Polls `spec.read`: at once when asked or on retry, else after one interval; pauses while hidden, aborts on unmount. Returns a retry control. */
export function usePolling<T>(spec: ReadingSpec<T>, settle: (outcome: ReadingOutcome<T>) => void, { readImmediately, restartKey }: PollingSchedule) {
    const [attempt, setAttempt] = useState(0);
    // Refs keep a caller's new spec or settle object from restarting the loop; only the schedule and retries restart it.
    // A passive effect declared before the loop updates them only after the previous loop's cleanup has cancelled it.
    const specRef = useRef(spec);
    const settleRef = useRef(settle);
    useEffect(() => {
        specRef.current = spec;
        settleRef.current = settle;
    }, [spec, settle]);
    const refreshReadings = useCallback(() => setAttempt((value) => value + 1), []);
    useEffect(() => {
        let cancelled = false;
        let inFlight = false;
        let timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController();
        const retryRequested = attempt > 0;
        /** Runs one bounded read, settles its outcome unless cancelled, and schedules the next. */
        async function load() {
            if (cancelled || inFlight || document.visibilityState === "hidden") return;
            clearTimeout(timer);
            inFlight = true;
            const outcome = await readWithinDeadline(specRef.current, controller.signal);
            inFlight = false;
            if (cancelled) return;
            settleRef.current(outcome);
            timer = setTimeout(() => void load(), specRef.current.interval);
        }
        /** Pauses polling while the tab is hidden and reads at once when it returns. */
        function visibilityChanged() {
            clearTimeout(timer);
            if (document.visibilityState !== "hidden") void load();
        }
        if (readImmediately || retryRequested) void load();
        else timer = setTimeout(() => void load(), specRef.current.interval);
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            controller.abort();
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, [restartKey, readImmediately, attempt]);
    return refreshReadings;
}

/** The message a failed read shows: its timeout's when the deadline passed, else the error's own, else a neutral one. */
export function readingErrorMessage(error: unknown, timedOut: boolean, timeout: ReadingTimeout | undefined): string {
    if (timedOut && timeout !== undefined) return timeout.message;
    if (error instanceof Error && error.message !== "") return error.message;
    return "The reading could not be loaded.";
}

/** Reads once under `signal` plus the spec's deadline, turning any failure into a reading outcome. */
async function readWithinDeadline<T>(spec: ReadingSpec<T>, signal: AbortSignal): Promise<ReadingOutcome<T>> {
    const deadlineController = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    if (spec.timeout !== undefined) deadline = setTimeout(() => deadlineController.abort(), spec.timeout.milliseconds);
    try {
        return { ok: true, result: await spec.read(AbortSignal.any([signal, deadlineController.signal])) };
    } catch (error) {
        const timedOut = deadlineController.signal.aborted;
        return { ok: false, error: readingErrorMessage(error, timedOut, spec.timeout) };
    } finally {
        clearTimeout(deadline);
    }
}
