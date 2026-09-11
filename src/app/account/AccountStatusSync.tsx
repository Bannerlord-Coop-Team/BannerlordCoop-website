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
        function refresh() {
            if (document.visibilityState === "hidden" || inFlight.current) return;
            inFlight.current = true;
            startTransition(() => router.refresh());
        }
        function onVisible() {
            if (document.visibilityState === "visible") refresh();
        }
        // Bound background retries; focus/online events keep later changes discoverable.
        const timer = pending ? window.setInterval(() => {
            if (document.visibilityState === "hidden" || inFlight.current) return;
            if (attempts >= 12) { window.clearInterval(timer); return; }
            attempts++;
            refresh();
        }, 5_000) : undefined;
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            if (timer !== undefined) window.clearInterval(timer);
            window.removeEventListener("focus", refresh);
            window.removeEventListener("online", refresh);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [pending, router]);
    return null;
}
