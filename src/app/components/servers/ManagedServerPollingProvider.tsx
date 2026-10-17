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
/** A backup request whose job never appears releases the lifecycle controls sooner. */
const UNATTACHED_BACKUP_DEADLINE_MILLISECONDS = 2 * 60_000;
const INITIALIZING_SERVER_STATES = new Set(["provisioning", "configuring"]);

type PollingSession = {
    serverId: string;
    initialUpdatedAt: string;
    jobId: string | null;
    statusSource: "server" | "backup" | "initialization";
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
        statusSource?: PollingSession["statusSource"],
    ) => void;
    attachJob: (serverId: string, jobId: string) => void;
    endPolling: (serverId: string) => void;
};

/** Game phases announced by the dedicated server's "@DS@" state records. */
export type ManagedGamePhase = "boot" | "loading" | "serving" | "stopping" | "fatal";

/** Campaign speeds an owner can choose; every game time mode reads as one of these. */
export type CampaignSpeed = "pause" | "play-1x" | "play-2x";

/** Live console evidence shared with lifecycle progress; connection numbers only ever increase. */
export type ManagedConsoleSignal =
    | { type: "opened"; serverId: string; connection: number }
    | { type: "phase"; serverId: string; connection: number; phase: ManagedGamePhase; detail?: string }
    | { type: "speed"; serverId: string; connection: number; speed: CampaignSpeed; heldBy?: "no-players" | "policy" }
    | { type: "closed"; serverId: string; connection: number; runEnded: boolean }
    | { type: "unavailable"; serverId: string };

export type ManagedConsoleSignals = {
    attach: (serverId: string) => () => void;
    isAttached: (serverId: string) => boolean;
    latestConnection: (serverId: string) => number;
    publish: (signal: ManagedConsoleSignal) => void;
    subscribe: (listener: (signal: ManagedConsoleSignal) => void) => () => void;
};

/** Owner saves in flight per server, so Stop and Restart wait instead of interrupting the game's save. */
export type ManagedServerSaves = {
    isSaving: (serverId: string) => boolean;
    /** Marks one save as in flight until the returned release runs; releasing twice has no effect. */
    beginSave: (serverId: string) => () => void;
};

const ManagedServerPollingContext = createContext<ManagedServerPollingContextValue | null>(null);
const ManagedConsoleSignalsContext = createContext<ManagedConsoleSignals | null>(null);
const ManagedServerSavesContext = createContext<ManagedServerSaves | null>(null);
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

/** Reads a compact status fingerprint; polling re-renders the page only when it changes. */
export type ManagedServerStatusReader = (serverId: string) => Promise<{ ok: true; fingerprint: string } | { ok: false }>;

/** Shares status polling and live console phases between the managed server's panels. */
export function ManagedServerPollingProvider({ children, readStatus, initialServer }: {
    children: ReactNode;
    readStatus?: ManagedServerStatusReader;
    initialServer?: { serverId: string; updatedAt: string; operationState: string };
}) {
    const router = useRouter();
    const [session, setSession] = useState<PollingSession | null>(null);
    const [timedOutSession, setTimedOutSession] = useState<PollingSession | null>(null);
    const [consoleSignals] = useState(createManagedConsoleSignals);
    const [savesInFlight, setSavesInFlight] = useState<ReadonlyMap<string, number>>(() => new Map());

    const beginSave = useCallback((serverId: string) => {
        const adjust = (change: number) => setSavesInFlight((current) => {
            const next = new Map(current);
            const count = (current.get(serverId) ?? 0) + change;
            if (count > 0) next.set(serverId, count);
            else next.delete(serverId);
            return next;
        });
        adjust(1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            adjust(-1);
        };
    }, []);

    const saves = useMemo<ManagedServerSaves>(() => ({
        isSaving: (serverId) => (savesInFlight.get(serverId) ?? 0) > 0,
        beginSave,
    }), [beginSave, savesInFlight]);

    const beginPolling = useCallback((
        serverId: string,
        initialUpdatedAt: string,
        jobId?: string,
        statusSource: PollingSession["statusSource"] = "server",
    ) => {
        const startedAt = Date.now();
        setTimedOutSession(null);
        setSession({
            serverId,
            initialUpdatedAt,
            jobId: jobId ?? null,
            statusSource,
            startedAt,
            deadline: startedAt + (statusSource === "backup" && jobId === undefined
                ? UNATTACHED_BACKUP_DEADLINE_MILLISECONDS : POLL_DEADLINE_MILLISECONDS),
        });
        router.refresh();
    }, [router]);

    const attachJob = useCallback((serverId: string, jobId: string) => {
        setSession((current) => current?.serverId === serverId
            && current.statusSource === "backup"
            && current.jobId === null
            ? { ...current, jobId, deadline: current.startedAt + POLL_DEADLINE_MILLISECONDS }
            : current);
    }, []);

    const endPolling = useCallback((serverId: string) => {
        setSession((current) => current?.serverId === serverId ? null : current);
        setTimedOutSession((current) => current?.serverId === serverId ? null : current);
    }, []);

    useEffect(() => {
        if (session === null) return;
        const { serverId, startedAt } = session;
        let timer: number | undefined;
        let refreshWhenVisible = false;
        let cancelled = false;
        let lastFingerprint: string | null = null;

        // Full page renders are expensive on the edge runtime, so unchanged status skips them.
        // The fingerprint is read before refreshing, so a change after it is caught next time.
        async function refreshIfChanged() {
            if (readStatus) {
                const result = await readStatus(serverId).catch(() => null);
                if (cancelled) return;
                if (result?.ok && result.fingerprint === lastFingerprint) return;
                lastFingerprint = result?.ok ? result.fingerprint : null;
            }
            router.refresh();
        }

        // Checks on a widening schedule; a hidden tab defers its check until it is shown again.
        async function tick() {
            if (document.visibilityState === "hidden") refreshWhenVisible = true;
            else await refreshIfChanged();
            if (!cancelled) timer = window.setTimeout(tick, managedServerPollDelay(Date.now() - startedAt));
        }

        // Catches up immediately when the owner returns to a tab that skipped checks.
        function refreshOnReturn() {
            if (document.visibilityState !== "visible" || !refreshWhenVisible) return;
            refreshWhenVisible = false;
            void refreshIfChanged();
        }

        timer = window.setTimeout(tick, managedServerPollDelay(Date.now() - startedAt));
        const deadline = window.setTimeout(() => {
            setTimedOutSession(session);
            setSession((current) => current?.deadline === session.deadline ? null : current);
        }, Math.max(0, session.deadline - Date.now()));
        document.addEventListener("visibilitychange", refreshOnReturn);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            window.clearTimeout(deadline);
            document.removeEventListener("visibilitychange", refreshOnReturn);
        };
    }, [readStatus, router, session]);

    const value = useMemo(() => ({ session, timedOutSession, beginPolling, attachJob, endPolling }), [
        attachJob,
        beginPolling,
        endPolling,
        session,
        timedOutSession,
    ]);

    useEffect(() => {
        if (initialServer === undefined) return;
        const initializing = INITIALIZING_SERVER_STATES.has(initialServer.operationState);
        const trackingInitialState = session?.serverId === initialServer.serverId
            && session.statusSource === "initialization";
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (initializing && !trackingInitialState) {
            timer = setTimeout(() => beginPolling(initialServer.serverId, initialServer.updatedAt, undefined, "initialization"), 0);
        } else if (!initializing && trackingInitialState) {
            timer = setTimeout(() => endPolling(initialServer.serverId), 0);
        }
        return () => clearTimeout(timer);
    }, [beginPolling, endPolling, initialServer, session]);

    return (
        <ManagedServerPollingContext.Provider value={value}>
            <ManagedConsoleSignalsContext.Provider value={consoleSignals}>
                <ManagedServerSavesContext.Provider value={saves}>
                    {children}
                </ManagedServerSavesContext.Provider>
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

/** Returns the polling channel when a managed panel is embedded in the workspace. */
export function useOptionalManagedServerPolling() {
    return useContext(ManagedServerPollingContext);
}

/** Returns the console signal channel, or null when the console is rendered on its own. */
export function useManagedConsoleSignals() {
    return useContext(ManagedConsoleSignalsContext);
}

/** Returns the shared save tracker, or null when a panel is rendered without the provider. */
export function useManagedServerSaves() {
    return useContext(ManagedServerSavesContext);
}

/** Returns the console toolbar's status row, or undefined when controls render outside it. */
export function useManagedServerStatusSlot() {
    return useContext(ManagedServerStatusSlotContext);
}
