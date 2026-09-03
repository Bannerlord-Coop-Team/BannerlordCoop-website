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

const POLL_INTERVAL_MILLISECONDS = 4_000;
const POLL_TIMEOUT_MILLISECONDS = 60_000;

type PollingSession = {
    serverId: string;
    initialUpdatedAt: string;
    deadline: number;
};

type ManagedServerPollingContextValue = {
    session: PollingSession | null;
    beginPolling: (serverId: string, initialUpdatedAt: string) => void;
    endPolling: (serverId: string) => void;
};

const ManagedServerPollingContext = createContext<ManagedServerPollingContextValue | null>(null);

export function ManagedServerPollingProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [session, setSession] = useState<PollingSession | null>(null);

    const beginPolling = useCallback((serverId: string, initialUpdatedAt: string) => {
        setSession({
            serverId,
            initialUpdatedAt,
            deadline: Date.now() + POLL_TIMEOUT_MILLISECONDS,
        });
        router.refresh();
    }, [router]);

    const endPolling = useCallback((serverId: string) => {
        setSession((current) => current?.serverId === serverId ? null : current);
    }, []);

    useEffect(() => {
        if (session === null) return;
        const remaining = Math.max(0, session.deadline - Date.now());
        const interval = window.setInterval(() => router.refresh(), POLL_INTERVAL_MILLISECONDS);
        const timeout = window.setTimeout(() => {
            setSession((current) => current?.deadline === session.deadline ? null : current);
        }, remaining);
        return () => {
            window.clearInterval(interval);
            window.clearTimeout(timeout);
        };
    }, [router, session]);

    const value = useMemo(() => ({ session, beginPolling, endPolling }), [
        beginPolling,
        endPolling,
        session,
    ]);

    return (
        <ManagedServerPollingContext.Provider value={value}>
            {children}
        </ManagedServerPollingContext.Provider>
    );
}

export function useManagedServerPolling() {
    const value = useContext(ManagedServerPollingContext);
    if (value === null) throw new Error("Managed server controls require a polling provider.");
    return value;
}
