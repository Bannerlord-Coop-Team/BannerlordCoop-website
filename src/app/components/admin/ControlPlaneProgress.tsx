"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";

const INTERVAL = 4_000;
const MAXIMUM_INTERVAL = 30_000;
function hidden() { return document.visibilityState === "hidden"; }

export function isActiveJob(job: { state: string }) {
    return ["queued", "running", "retry-wait"].includes(job.state);
}

/** Each read reauthenticates upstream; a timer starts only after the preceding read settles. */
export function useControlPlaneProgress<T>(initial: T, read: (current: T, token: string, signal: AbortSignal) => Promise<T>,
    active: (value: T) => boolean, fingerprint: (value: T) => string) {
    const [snapshot, setSnapshot] = useState<{ initial: T; value: T | null; error?: string }>();
    useEffect(() => {
        let value = initial;
        let stopped = false;
        let disposed = false;
        let inFlight = false;
        let resume = false;
        let delay = INTERVAL;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let request: AbortController | undefined;
        function schedule(wait: number) {
            if (!disposed && !stopped && active(value) && !hidden()) {
                timer = setTimeout(() => void load(), wait);
            }
        }
        async function load() {
            if (disposed || stopped || inFlight || !active(value) || hidden()) return;
            clearTimeout(timer);
            inFlight = true;
            resume = false;
            const controller = new AbortController();
            request = controller;
            const deadline = setTimeout(() => controller.abort(new Error("Progress read timed out.")), 30_000);
            try {
                const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
                if (disposed || controller.signal.aborted) return;
                if (!session?.access_token) throw new ControlPlaneAdminError("unauthenticated", "Authentication is required.");
                const next = await read(value, session.access_token, controller.signal);
                if (disposed || controller.signal.aborted) return;
                delay = fingerprint(next) === fingerprint(value) ? Math.min(delay * 2, MAXIMUM_INTERVAL) : INTERVAL;
                value = next;
                setSnapshot({ initial, value });
            } catch (cause) {
                if (disposed || hidden() || resume) return;
                stopped = cause instanceof ControlPlaneAdminError && !cause.retryable;
                setSnapshot({ initial, value: stopped ? null : value,
                    error: stopped && cause instanceof Error ? cause.message : "Progress could not be refreshed. Showing the last reading; retrying." });
                delay = Math.min(delay * 2, MAXIMUM_INTERVAL);
            } finally {
                clearTimeout(deadline);
                inFlight = false;
                request = undefined;
                schedule(resume ? 0 : delay);
            }
        }
        function visibilityChanged() {
            clearTimeout(timer);
            if (hidden()) request?.abort();
            else { delay = INTERVAL; resume = true; void load(); }
        }
        schedule(INTERVAL);
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => {
            disposed = true;
            clearTimeout(timer);
            request?.abort();
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, [initial, read, active, fingerprint]);
    const current = snapshot?.initial === initial ? snapshot : { value: initial, error: undefined };
    return { ...current, active: current.value !== null && active(current.value) };
}

export function ControlPlaneProgress({ active, error }: { active: boolean; error?: string }) {
    if (error) return <p role="alert" className="text-sm text-red-200">{error}</p>;
    if (!active) return null;
    return <p className="inline-flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.1em] text-gold" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> Updating progress while this tab is visible
    </p>;
}
