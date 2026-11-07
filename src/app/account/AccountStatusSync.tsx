"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refresh read-only status, never retry OAuth mutations or start authorization. */
export function AccountStatusSync({ pending }: { pending: boolean }) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const inFlight = useRef(false);
    useEffect(() => { inFlight.current = refreshing; }, [refreshing]);

    useEffect(() => {
        let attempts = 0;
        let timer: number | undefined;
        function refresh() {
            if (document.visibilityState === "hidden" || inFlight.current) return;
            inFlight.current = true;
            startTransition(() => router.refresh());
        }
        function onVisible() {
            if (document.visibilityState === "visible") refresh();
        }
        // Fast for the first minute, then a bounded slow fallback for as long as status is pending.
        function schedule() {
            timer = window.setTimeout(() => {
                if (document.visibilityState !== "hidden" && !inFlight.current) {
                    attempts = Math.min(attempts + 1, 30);
                    refresh();
                }
                schedule();
            }, attempts < 30 ? 2_000 : 10_000);
        }
        if (pending) schedule();
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            if (timer !== undefined) window.clearTimeout(timer);
            window.removeEventListener("focus", refresh);
            window.removeEventListener("online", refresh);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [pending, router]);
    return null;
}
