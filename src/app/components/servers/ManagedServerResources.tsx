"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useEffect, useState } from "react";
import type { ManagedServerResources as Resources } from "@/app/lib/hosting/my-servers-server";
import { readManagedServerResources } from "@/app/servers/managed-server-actions";

/** Usage changes slowly enough that a few reads a minute stay current without loading the runner. */
export const RESOURCE_POLL_MILLISECONDS = 10_000;
const GIBIBYTE = 1_024 ** 3;

/** The share of the server's own allocation in use; the cgroup quota keeps CPU at or below its limit. */
export function resourceShares(resources: Resources) {
    return {
        cpu: Math.min(1, resources.cpuVcpus / resources.cpuLimitVcpus),
        memory: Math.min(1, resources.memoryUsedBytes / resources.memoryLimitBytes),
    };
}

/**
 * CPU and memory of this server's own allocation, such as 2 of a VPS's 6 vCPUs. Shown only while the game runs,
 * and read only while the page is visible.
 */
export function ManagedServerResources({ serverId, running }: { serverId: string; running: boolean }) {
    const { t, number } = useTranslations("managed-server");
    const [resources, setResources] = useState<Resources | null>(null);

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
                if (result.ok) setResources(result.resources);
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
            setResources(null);
        };
    }, [serverId, running]);

    if (!running || resources === null) return null;
    const shares = resourceShares(resources);
    const decimals = (value: number) => number(value, { maximumFractionDigits: 2 });
    const gibibytes = (bytes: number) => number(bytes / GIBIBYTE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return (
        <section aria-label={t("resources.resourceUsage")} className="flex flex-wrap gap-x-6 gap-y-3 px-3 pb-3 sm:px-4">
            <Meter label={t("resources.cpu")} share={shares.cpu} percent={number(shares.cpu, { style: "percent" })}
                detail={t("resources.cpuOfAllocated", { used: decimals(resources.cpuVcpus), limit: decimals(resources.cpuLimitVcpus) })} />
            <Meter label={t("resources.memory")} share={shares.memory} percent={number(shares.memory, { style: "percent" })}
                detail={t("resources.memoryOfAllocated", { used: gibibytes(resources.memoryUsedBytes), limit: gibibytes(resources.memoryLimitBytes) })} />
        </section>
    );
}

// Renders one labelled usage bar with its percentage and allocation detail.
function Meter({ label, share, percent, detail }: { label: string; share: number; percent: string; detail: string }) {
    return (
        <div className="flex min-w-44 flex-1 flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs text-foreground-muted">
                <span>{label}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">{percent}</span>
            </div>
            <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-valuetext={`${percent}, ${detail}`}
                className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${share >= 0.9 ? "bg-red-400" : "bg-gold"}`} style={{ width: `${share * 100}%` }} />
            </div>
            <p className="text-xs tabular-nums text-foreground-muted">{detail}</p>
        </div>
    );
}
