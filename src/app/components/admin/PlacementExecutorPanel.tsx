"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Empty } from "@/app/components/admin/ControlPlanePresentation";
import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
import { ControlPlaneAdminError, requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { operationExplanation } from "@/app/lib/control-plane/explanations";
import {
    alwaysOnPolicyLabel,
    formatPlacementGain,
    PLACEMENT_ALWAYS_ON_POLICIES,
    PLACEMENT_EXECUTOR_LIMITS,
    placementExecutorEnableConfirmation,
    placementExecutorErrorMessage,
    placementExecutorForm,
    placementExecutorInput,
    placementRelocationStateLabel,
    type PlacementExecutorForm,
} from "@/app/lib/control-plane/placement";
import type { HostingAdminPlacementExecutor, HostingPlacementAlwaysOnPolicy, HostingPlacementExecutorSettings, HostingPlacementRelocation } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";

const inputClass = "mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground outline-none placeholder:text-foreground-dim focus:border-gold disabled:opacity-60";
const labelClass = "font-label text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-foreground-muted";
const badgeClass = "inline-flex w-fit border px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em]";
const FIELD_HELP: Record<keyof typeof PLACEMENT_EXECUTOR_LIMITS, string> = {
    maximumRelocationsPerDay: "Relocations it may queue in any rolling 24 hours.",
    minimumGainHours: "Co-online pair-hours per week one move must save on its own.",
    noticeLeadHours: "Hours between announcing a running server's move on its page and making it.",
};
const STATE_BADGES: Record<HostingPlacementRelocation["state"], string> = {
    announced: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    queued: "border-gold/40 bg-gold/10 text-gold",
    succeeded: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    failed: "border-crimson/30 bg-crimson/10 text-red-200",
    cancelled: "border-white/15 text-foreground-muted",
};

async function readExecutor(): Promise<HostingAdminPlacementExecutor> {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session?.access_token) throw new Error("Authentication is required.");
    const result = await requestControlPlaneAdmin<HostingAdminPlacementExecutor>({
        accessToken: session.access_token,
        requestId: crypto.randomUUID(),
        operation: "placement-executor",
        input: {},
    });
    if (typeof result?.settings !== "object" || result.settings === null || typeof result.settings.enabled !== "boolean" || !Array.isArray(result.relocations)) {
        throw new Error("The control plane returned unexpected executor settings.");
    }
    return result;
}

/**
 * The automatic placement executor's settings and recent relocations. Turning it on lets the
 * control plane move customer servers by itself, so the current state is shown first and
 * enabling needs an explicit confirmation.
 */
export function PlacementExecutorPanel() {
    const [executor, setExecutor] = useState<HostingAdminPlacementExecutor | null>(null);
    const [form, setForm] = useState<PlacementExecutorForm | null>(null);
    const [loadError, setLoadError] = useState("");
    const [reload, setReload] = useState(0);
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        readExecutor().then((value) => {
            if (cancelled) return;
            setExecutor(value);
            setForm(placementExecutorForm(value.settings));
            setLoadError("");
        }, (cause: unknown) => {
            if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "The executor settings could not be loaded.");
        });
        return () => { cancelled = true; };
    }, [reload]);

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (executor === null || form === null || pending) return;
        const parsed = placementExecutorInput(form, executor.settings.updatedAt);
        if ("error" in parsed) {
            setResult({ ok: false, message: parsed.error });
            return;
        }
        const input = parsed.input as { maximumRelocationsPerDay: number; minimumGainHours: number; noticeLeadHours: number; alwaysOnPolicy: HostingPlacementAlwaysOnPolicy };
        if (form.enabled && !executor.settings.enabled && !window.confirm(placementExecutorEnableConfirmation(input))) return;
        setPending(true);
        setResult(null);
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            const settings = await requestControlPlaneAdmin<HostingPlacementExecutorSettings>({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "set-placement-executor",
                input: parsed.input,
            });
            setExecutor((current) => current === null ? current : { ...current, settings });
            setForm(placementExecutorForm(settings));
            setResult({ ok: true, message: settings.enabled ? "Saved. Automatic placement is on." : "Saved. Automatic placement is off." });
        } catch (cause) {
            if (cause instanceof ControlPlaneAdminError && cause.code === "stale_interaction") {
                // Someone else saved first: show their settings rather than overwrite them.
                try {
                    const fresh = await readExecutor();
                    setExecutor(fresh);
                    setForm(placementExecutorForm(fresh.settings));
                } catch { /* The stale message below still asks for a reload. */ }
            }
            setResult({ ok: false, message: placementExecutorErrorMessage(cause) });
        } finally {
            setPending(false);
        }
    }

    const settings = executor?.settings ?? null;
    return (
        <section className={`border bg-surface p-5 ${settings?.enabled ? "border-crimson/50" : "border-white/10"}`} aria-labelledby="placement-executor-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                    <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">Automatic executor</p>
                    <h2 id="placement-executor-heading" className="mt-1 font-display text-3xl font-semibold text-foreground">Automatic placement</h2>
                    <p className="mt-2 text-xs leading-5 text-foreground-muted">{operationExplanation("set-placement-executor")}</p>
                </div>
                {settings !== null && (settings.enabled
                    ? <span role="status" className="inline-flex items-center gap-2 border border-crimson/50 bg-crimson/15 px-3 py-2 font-label text-xs font-semibold uppercase tracking-[0.12em] text-red-100">On · relocating servers automatically</span>
                    : <span role="status" className="inline-flex items-center gap-2 border border-white/15 px-3 py-2 font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted">Off · nothing moves automatically</span>)}
            </div>
            {loadError && <p role="alert" className="mt-4 border-l-2 border-crimson bg-crimson/10 px-3 py-2 text-xs text-red-200">{loadError} <button type="button" className="ml-2 underline" onClick={() => setReload((value) => value + 1)}>Retry</button></p>}
            {settings === null && !loadError && <p className="mt-4 text-xs text-foreground-muted" role="status">Loading executor settings…</p>}
            {settings !== null && form !== null && <>
                <p className="mt-4 text-xs text-foreground-muted">
                    {settings.updatedAt === null
                        ? "Never saved; these are the control plane's defaults."
                        : <>Last changed <LocalDateTime value={settings.updatedAt} /> by <span className="font-mono text-foreground">{settings.updatedBy ?? "unknown"}</span>{settings.reason ? <>: <span className="text-foreground">{settings.reason}</span></> : null}</>}
                </p>
                <p className="mt-1 text-xs text-foreground-dim">
                    Saved: up to {settings.maximumRelocationsPerDay} per day · at least {settings.minimumGainHours} pair-h/week each · always-on servers: {lowerFirst(alwaysOnPolicyLabel(settings.alwaysOnPolicy))} · {settings.noticeLeadHours} h notice
                </p>
                <form onSubmit={(event) => void save(event)} className="mt-5">
                    <label className="flex items-center gap-3 text-sm text-foreground">
                        <input type="checkbox" name="enabled" checked={form.enabled} disabled={pending} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="size-4 accent-crimson" />
                        Relocate servers automatically
                    </label>
                    {form.enabled && !settings.enabled && <p className="mt-2 text-xs text-amber-200">Saving turns automatic relocation on. Each move stops the game for a few minutes and changes the server&apos;s address and game port.</p>}
                    {!form.enabled && settings.enabled && <p className="mt-2 text-xs text-foreground-muted">Saving turns it off: announced moves are cancelled and their notices withdrawn; a relocation already running finishes.</p>}
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {(Object.keys(PLACEMENT_EXECUTOR_LIMITS) as Array<keyof typeof PLACEMENT_EXECUTOR_LIMITS>).map((name) => {
                            const limit = PLACEMENT_EXECUTOR_LIMITS[name];
                            return (
                                <label key={name} className="block">
                                    <span className={labelClass}>{limit.label}</span>
                                    <input name={name} type="number" inputMode="numeric" min={limit.minimum} max={limit.maximum} step={1} required value={form[name]} disabled={pending}
                                        onChange={(event) => setForm({ ...form, [name]: event.target.value })} className={inputClass} />
                                    <span className="mt-1 block text-[0.65rem] leading-4 text-foreground-dim">{limit.minimum}–{limit.maximum}. {FIELD_HELP[name]}</span>
                                </label>
                            );
                        })}
                        <label className="block">
                            <span className={labelClass}>Always-on servers</span>
                            <select name="alwaysOnPolicy" value={form.alwaysOnPolicy} disabled={pending} onChange={(event) => setForm({ ...form, alwaysOnPolicy: event.target.value })} className={inputClass}>
                                {PLACEMENT_ALWAYS_ON_POLICIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <span className="mt-1 block text-[0.65rem] leading-4 text-foreground-dim">Where servers online even in their quietest window may move.</span>
                        </label>
                    </div>
                    <label className="mt-4 block max-w-xl">
                        <span className={labelClass}>Reason</span>
                        <input name="reason" value={form.reason} maxLength={1_000} disabled={pending} placeholder="Recorded in the audit history" onChange={(event) => setForm({ ...form, reason: event.target.value })} className={inputClass} />
                    </label>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                        <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center gap-1.5 border border-crimson bg-crimson px-5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-white hover:bg-crimson-hover disabled:cursor-wait disabled:opacity-60">
                            {pending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Save aria-hidden="true" className="size-3.5" />}{pending ? "Saving" : "Save settings"}
                        </button>
                        <button type="button" disabled={pending} onClick={() => { setForm(placementExecutorForm(settings)); setResult(null); }} className="inline-flex min-h-10 items-center border border-white/15 px-4 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted hover:text-foreground disabled:opacity-40">Discard changes</button>
                    </div>
                    {result && <p role={result.ok ? "status" : "alert"} className={`mt-4 border-l-2 px-3 py-2 text-xs ${result.ok ? "border-emerald-500 bg-emerald-500/10 text-emerald-200" : "border-crimson bg-crimson/10 text-red-200"}`}>{result.message}</p>}
                </form>
                <PlacementRelocations relocations={executor?.relocations ?? []} />
            </>}
        </section>
    );
}

// Labels start a sentence; mid-sentence only their first letter drops, keeping "VPSs" intact.
function lowerFirst(text: string) {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

function PlacementRelocations({ relocations }: { relocations: readonly HostingPlacementRelocation[] }) {
    return (
        <div className="mt-6">
            <h3 className="font-display text-xl font-semibold text-foreground">Recent automatic relocations</h3>
            <div className="mt-3 overflow-x-auto border border-white/10">
                <table className="w-full min-w-260 text-left text-xs">
                    <thead className="border-b border-white/10 font-label text-[0.6rem] uppercase tracking-[0.12em] text-foreground-muted">
                        <tr><th className="p-3">Server</th><th className="p-3">VPS</th><th className="p-3">Mode</th><th className="p-3">State</th><th className="p-3 text-right">Gain</th><th className="p-3">Scheduled</th><th className="p-3">Queued</th><th className="p-3">Completed</th><th className="p-3">Error</th></tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">{relocations.map((relocation) => (
                        <tr key={relocation.relocationId}>
                            <td className="p-3"><p className="font-semibold text-gold">{relocation.displayName}</p><p className="mt-1 text-foreground-muted">{hostingRegionLabel(relocation.targetRegion)}</p></td>
                            <td className="p-3 font-mono text-foreground-muted">{relocation.fromServiceName} → <span className="text-foreground">{relocation.toServiceName}</span></td>
                            <td className="p-3 text-foreground-muted" title={relocation.mode === "announced" ? "Announced on the server's page, then moved after the notice lead time." : "Moved while the server was stopped."}>{relocation.mode === "announced" ? "Announced" : "Offline"}</td>
                            <td className="p-3"><span className={`${badgeClass} ${STATE_BADGES[relocation.state] ?? STATE_BADGES.cancelled}`}>{placementRelocationStateLabel(relocation.state)}</span></td>
                            <td className="p-3 text-right font-mono text-foreground">{formatPlacementGain(relocation.gainPairHoursPerWeek)}</td>
                            <td className="p-3 text-foreground-muted"><LocalDateTime value={relocation.scheduledAt} /></td>
                            <td className="p-3 text-foreground-muted"><LocalDateTime value={relocation.queuedAt} empty="—" /></td>
                            <td className="p-3 text-foreground-muted"><LocalDateTime value={relocation.completedAt} empty="—" /></td>
                            <td className="p-3 font-mono text-foreground-muted">{relocation.errorCode ?? "—"}</td>
                        </tr>
                    ))}</tbody>
                </table>
                {relocations.length === 0 && <Empty>No automatic relocations yet.</Empty>}
            </div>
        </div>
    );
}
