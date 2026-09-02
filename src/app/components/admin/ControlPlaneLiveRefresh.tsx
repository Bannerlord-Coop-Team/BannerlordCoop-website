"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ControlPlaneLiveRefresh({
    active,
    label,
}: {
    active: boolean;
    label: string;
}) {
    const router = useRouter();

    useEffect(() => {
        if (!active) return;
        const interval = window.setInterval(() => router.refresh(), 4_000);
        return () => window.clearInterval(interval);
    }, [active, router]);

    if (!active) return null;
    return (
        <p className="inline-flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.1em] text-gold" aria-live="polite">
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            {label}
        </p>
    );
}
