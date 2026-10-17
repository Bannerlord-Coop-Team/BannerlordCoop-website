"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useEffect, useState } from "react";
import type { ServerResourceUsage } from "@/app/lib/hosting/server-resource-usage";
import { readManagedServerResources } from "@/app/servers/managed-server-actions";

/** Usage changes slowly enough that a few reads a minute stay current without loading the runner. */
export const RESOURCE_POLL_MILLISECONDS = 10_000;

/**
 * CPU and memory as percentages of this server's own allocation, never the allocation itself. Shown only while
 * the game runs, and read only while the page is visible.
 */
export function ManagedServerResources({ serverId, running }: { serverId: string; running: boolean }) {
    const { t, number } = useTranslations("managed-server");
    const [usage, setUsage] = useState<ServerResourceUsage | null>(null);

    useEffect(() => {
        if (!running) return;
        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        async function read() {
            clearTimeout(timeout);
            if (document.visibilityState === "visible") {
                const result = await readManagedServerResources(serverId).catch(() => ({ ok: false as const }));
                if (cancelled) return;
                // A failed read keeps the last sample; a confirmed "not available" hides the meters.
                if (result.ok) setUsage(result.usage);
            }
            timeout = setTimeout(read, RESOURCE_POLL_MILLISECONDS);
        }
        const resume = () => { if (document.visibilityState === "visible") void read(); };
        void read();
        document.addEventListener("visibilitychange", resume);
        return () => {
            cancelled = true;
            clearTimeout(timeout);
            document.removeEventListener("visibilitychange", resume);
            setUsage(null);
        };
    }, [serverId, running]);

    if (!running || usage === null) return null;
    return (
        <section aria-label={t("resources.resourceUsage")} className="flex flex-wrap gap-x-6 gap-y-3 px-3 pb-3 sm:px-4">
            <Meter label={t("resources.cpu")} share={usage.cpu} percent={number(usage.cpu, { style: "percent" })} />
            <Meter label={t("resources.memory")} share={usage.memory} percent={number(usage.memory, { style: "percent" })} />
        </section>
    );
}

// Renders one labelled usage bar with its percentage.
function Meter({ label, share, percent }: { label: string; share: number; percent: string }) {
    return (
        <div className="flex min-w-44 flex-1 flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs text-foreground-muted">
                <span>{label}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">{percent}</span>
            </div>
            <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-valuetext={percent}
                className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${share >= 0.9 ? "bg-red-400" : "bg-gold"}`} style={{ width: `${share * 100}%` }} />
            </div>
        </div>
    );
}
