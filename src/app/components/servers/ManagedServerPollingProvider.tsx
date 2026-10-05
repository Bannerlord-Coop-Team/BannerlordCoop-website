"use client";

import { useRouter } from "next/navigation";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

/** Matches Start progress: long-running operations are followed for up to fifteen minutes. */
const POLL_DEADLINE_MILLISECONDS = 15 * 60_000;

type PollingSession = {
    serverId: string;
    initialUpdatedAt: string;
    jobId: string | null;
    statusSource: "server" | "backup";
    startedAt: number;
    deadline: number;
};

type ManagedServerPollingContextValue = {
    session: PollingSession | null;
    timedOutSession: PollingSession | null;
    beginPolling: (
        serverId: string,
        initialUpdatedAt: string,
        jobId?: string,
        statusSource?: "server" | "backup",
    ) => void;
    attachJob: (serverId: string, jobId: string) => void;
    endPolling: (serverId: string) => void;
};

/** Game phases announced by the dedicated server's "@DS@" state records. */
export type ManagedGamePhase = "boot" | "loading" | "serving" | "stopping" | "fatal";

/** Live console evidence shared with lifecycle progress; connection numbers only ever increase. */
export type ManagedConsoleSignal =
    | { type: "opened"; serverId: string; connection: number }
    | { type: "phase"; serverId: string; connection: number; phase: ManagedGamePhase; detail?: string }
    | { type: "closed"; serverId: string; connection: number; runEnded: boolean }
    | { type: "unavailable"; serverId: string };

export type ManagedConsoleSignals = {
    attach: (serverId: string) => () => void;
    isAttached: (serverId: string) => boolean;
    latestConnection: (serverId: string) => number;
    publish: (signal: ManagedConsoleSignal) => void;
    subscribe: (listener: (signal: ManagedConsoleSignal) => void) => () => void;
};

const ManagedServerPollingContext = createContext<ManagedServerPollingContextValue | null>(null);
const ManagedConsoleSignalsContext = createContext<ManagedConsoleSignals | null>(null);
/** Undefined outside the console toolbar; null until the toolbar's status row has mounted. */
export const ManagedServerStatusSlotContext = createContext<HTMLElement | null | undefined>(undefined);

/** Spaces status refreshes further apart as an operation runs longer: every 4 s, then 8 s, then 15 s. */
export function managedServerPollDelay(elapsedMilliseconds: number) {
    if (elapsedMilliseconds < 60_000) return 4_000;
    if (elapsedMilliseconds < 3 * 60_000) return 8_000;
    return 15_000;
}

/** Creates the in-memory channel that carries live console phases to lifecycle progress. */
export function createManagedConsoleSignals(): ManagedConsoleSignals {
    const listeners = new Set<(signal: ManagedConsoleSignal) => void>();
    const attached = new Map<string, number>();
    const connections = new Map<string, number>();
    return {
        attach(serverId) {
            attached.set(serverId, (attached.get(serverId) ?? 0) + 1);
            let detached = false;
            return () => {
                if (detached) return;
                detached = true;
                const remaining = (attached.get(serverId) ?? 1) - 1;
                if (remaining > 0) attached.set(serverId, remaining);
                else attached.delete(serverId);
            };
        },
        isAttached: (serverId) => (attached.get(serverId) ?? 0) > 0,
        latestConnection: (serverId) => connections.get(serverId) ?? 0,
        publish(signal) {
            if (signal.type !== "unavailable") {
                connections.set(signal.serverId, Math.max(connections.get(signal.serverId) ?? 0, signal.connection));
            }
            for (const listener of [...listeners]) listener(signal);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

/** Shares status polling and live console phases between the managed server's panels. */
export function ManagedServerPollingProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [session, setSession] = useState<PollingSession | null>(null);
    const [timedOutSession, setTimedOutSession] = useState<PollingSession | null>(null);
    const [consoleSignals] = useState(createManagedConsoleSignals);

    const beginPolling = useCallback((
        serverId: string,
        initialUpdatedAt: string,
        jobId?: string,
        statusSource: "server" | "backup" = "server",
    ) => {
        const startedAt = Date.now();
        setTimedOutSession(null);
        setSession({
            serverId,
            initialUpdatedAt,
            jobId: jobId ?? null,
            statusSource,
            startedAt,
            deadline: startedAt + POLL_DEADLINE_MILLISECONDS,
        });
        router.refresh();
    }, [router]);

    const attachJob = useCallback((serverId: string, jobId: string) => {
        setSession((current) => current?.serverId === serverId
            && current.statusSource === "backup"
            && current.jobId === null
            ? { ...current, jobId }
            : current);
    }, []);

    const endPolling = useCallback((serverId: string) => {
        setSession((current) => current?.serverId === serverId ? null : current);
        setTimedOutSession((current) => current?.serverId === serverId ? null : current);
    }, []);

    useEffect(() => {
        if (session === null) return;
        const { startedAt } = session;
        let timer: number | undefined;
        let refreshWhenVisible = false;

        // Refreshes on a widening schedule; a hidden tab defers its refresh until it is shown again.
        function tick() {
            if (document.visibilityState === "hidden") refreshWhenVisible = true;
            else router.refresh();
            timer = window.setTimeout(tick, managedServerPollDelay(Date.now() - startedAt));
        }

        // Catches up immediately when the owner returns to a tab that skipped refreshes.
        function refreshOnReturn() {
            if (document.visibilityState !== "visible" || !refreshWhenVisible) return;
            refreshWhenVisible = false;
            router.refresh();
        }

        timer = window.setTimeout(tick, managedServerPollDelay(Date.now() - startedAt));
        const deadline = window.setTimeout(() => {
            setTimedOutSession(session);
            setSession((current) => current?.deadline === session.deadline ? null : current);
        }, Math.max(0, session.deadline - Date.now()));
        document.addEventListener("visibilitychange", refreshOnReturn);
        return () => {
            window.clearTimeout(timer);
            window.clearTimeout(deadline);
            document.removeEventListener("visibilitychange", refreshOnReturn);
        };
    }, [router, session]);

    const value = useMemo(() => ({ session, timedOutSession, beginPolling, attachJob, endPolling }), [
        attachJob,
        beginPolling,
        endPolling,
        session,
        timedOutSession,
    ]);

    return (
        <ManagedServerPollingContext.Provider value={value}>
            <ManagedConsoleSignalsContext.Provider value={consoleSignals}>
                {children}
            </ManagedConsoleSignalsContext.Provider>
        </ManagedServerPollingContext.Provider>
    );
}

/** Reads the shared polling session; lifecycle panels require the provider. */
export function useManagedServerPolling() {
    const value = useContext(ManagedServerPollingContext);
    if (value === null) throw new Error("Managed server controls require a polling provider.");
    return value;
}

/** Returns the console signal channel, or null when the console is rendered on its own. */
export function useManagedConsoleSignals() {
    return useContext(ManagedConsoleSignalsContext);
}

/** Returns the console toolbar's status row, or undefined when controls render outside it. */
export function useManagedServerStatusSlot() {
    return useContext(ManagedServerStatusSlotContext);
}
