"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useEffect, useState } from "react";
import { Cpu, MemoryStick, type LucideIcon } from "lucide-react";
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
        <section aria-label={t("resources.resourceUsage")} className="grid grid-cols-2 gap-2 px-3 pb-3 sm:px-4">
            <UsageCard label={t("resources.cpu")} icon={Cpu} share={usage.cpu} percent={number(usage.cpu, { style: "percent" })} />
            <UsageCard label={t("resources.memory")} icon={MemoryStick} share={usage.memory} percent={number(usage.memory, { style: "percent" })} />
        </section>
    );
}

// Renders one usage card whose background fills from the bottom with the share used. Past 100% the fill
// rescales so the allocation becomes a marked line and the burst above it shows in its own colour.
function UsageCard({ label, icon: Icon, share, percent }: { label: string; icon: LucideIcon; share: number; percent: string }) {
    const scale = Math.max(1, share);
    const bursting = share > 1;
    const critical = share >= 0.9;
    return (
        <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(scale * 100)} aria-valuenow={Math.round(share * 100)} aria-valuetext={percent}
            className={`relative isolate flex min-h-11 items-center gap-2 overflow-hidden rounded-md border px-3 py-2 ${critical ? "border-red-400/40" : "border-white/15"} bg-white/[0.03]`}>
            <div aria-hidden className="absolute inset-0 -z-10 flex flex-col-reverse">
                <div className={`w-full transition-[height] duration-700 ease-out motion-reduce:transition-none ${critical ? "bg-red-400/25" : "bg-gold/25"}`} style={{ height: `${(Math.min(share, 1) / scale) * 100}%` }} />
                {bursting && <div data-burst className="w-full bg-sky-400/30 transition-[height] duration-700 ease-out motion-reduce:transition-none" style={{ height: `${((share - 1) / scale) * 100}%` }} />}
            </div>
            {bursting && <div aria-hidden className="absolute inset-x-0 -z-10 h-px bg-foreground/50" style={{ bottom: `${(1 / scale) * 100}%` }} />}
            <Icon aria-hidden className={`size-4 shrink-0 ${critical ? "text-red-300" : "text-gold"}`} />
            <span className="min-w-0 truncate text-xs font-medium text-foreground/85">{label}</span>
            <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">{percent}</span>
        </div>
    );
}
