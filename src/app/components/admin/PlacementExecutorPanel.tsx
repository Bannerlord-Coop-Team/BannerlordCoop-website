"use client";

import { Check, LoaderCircle, Save } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { Empty } from "@/app/components/admin/ControlPlanePresentation";
import { LocalDateTime, LocalTime } from "@/app/components/admin/LocalDateTime";
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
import {
    activePlacementRelocation,
    createPlacementExecutorReads,
    isActivePlacementRelocation,
    orderPlacementRelocations,
    PLACEMENT_LIVE_POLL_MILLISECONDS,
    placementBackoffs,
    placementMoveStanding,
    placementMoveStandingNote,
    placementMoveStepLabel,
    placementMovesQueuedLabel,
    placementRelocationDuration,
    placementRelocationErrorLabel,
    placementRelocationProgress,
    placementRelocationTrack,
    shortServiceName,
    type PlacementMoveStanding,
    type PlacementTrackPhase,
    type PlacementTrackStep,
} from "@/app/lib/control-plane/placement-live-moves";
import type { HostingAdminPlacementExecutor, HostingPlacementAlwaysOnPolicy, HostingPlacementExecutorSettings, HostingPlacementRelocation } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";

const inputClass = "mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground outline-none placeholder:text-foreground-dim focus:border-gold disabled:opacity-60";
const labelClass = "font-label text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-foreground-muted";
const badgeClass = "inline-flex w-fit border px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em]";
const FIELD_HELP: Record<keyof typeof PLACEMENT_EXECUTOR_LIMITS, string> = {
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
// Each stop on a move's track says its phase in words; colour only repeats it.
const TRACK_PHASES: Record<PlacementTrackPhase, { className: string; label: string }> = {
    done: { className: "border-emerald-500/30 text-foreground", label: "done" },
    current: { className: "border-gold bg-gold/15 text-gold", label: "current step" },
    waiting: { className: "border-white/10 text-foreground-dim", label: "not reached" },
    "not-needed": { className: "border-white/10 text-foreground-muted", label: "not needed" },
    failed: { className: "border-crimson/50 bg-crimson/10 text-red-200", label: "failed" },
    cancelled: { className: "border-white/15 text-foreground-muted", label: "cancelled" },
};
// How a queued move that is not simply moving forward reads, on the status line and its row.
const STANDING_LABELS: Partial<Record<PlacementMoveStanding, string>> = {
    returning: "Returning",
    "job-failed": "Move failed",
    "job-cancelled": "Move cancelled",
    "job-succeeded": "Move finished",
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
    // Polls, the stale-save reload and Retry share one read at a time.
    const [reads] = useState(() => createPlacementExecutorReads(readExecutor));
    // The legacy compatibility field as the latest read of any kind gave it: a save sends it back unchanged.
    const [compatibilityValue, setCompatibilityValue] = useState<unknown>(undefined);

    // While a move is announced or queued, follow it: re-read the executor on a visible page only.
    const following = executor?.relocations.some(isActivePlacementRelocation) ?? false;
    useEffect(() => {
        if (!following) return;
        let cancelled = false;
        let timer: number | undefined;
        let inFlight = false;
        let readAgain = false;

        async function poll() {
            window.clearTimeout(timer);
            timer = undefined;
            if (document.visibilityState === "hidden") return;
            if (inFlight) {
                readAgain = true;
                return;
            }
            inFlight = true;
            try {
                const fresh = await reads.shared();
                // Only what the executor is doing: the settings stay as read, so a save is still checked against them.
                if (!cancelled) {
                    setExecutor((current) => current === null ? current : { ...current, status: fresh.status, relocations: fresh.relocations });
                    setCompatibilityValue(fresh.settings.maximumRelocationsPerDay);
                }
            } catch {
                // The moves already shown stay; the next read tries again.
            } finally {
                inFlight = false;
            }
            if (cancelled) return;
            if (readAgain) {
                readAgain = false;
                void poll();
            } else {
                timer = window.setTimeout(poll, PLACEMENT_LIVE_POLL_MILLISECONDS);
            }
        }

        // A page shown again catches up at once rather than waiting out the interval.
        function pollOnReturn() {
            if (document.visibilityState === "visible") void poll();
        }

        timer = window.setTimeout(poll, PLACEMENT_LIVE_POLL_MILLISECONDS);
        document.addEventListener("visibilitychange", pollOnReturn);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", pollOnReturn);
        };
    }, [following, reads]);

    useEffect(() => {
        let cancelled = false;
        reads.fresh().then((value) => {
            if (cancelled) return;
            setExecutor(value);
            setForm(placementExecutorForm(value.settings));
            setCompatibilityValue(value.settings.maximumRelocationsPerDay);
            setLoadError("");
        }, (cause: unknown) => {
            if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "The executor settings could not be loaded.");
        });
        return () => { cancelled = true; };
    }, [reload, reads]);

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (executor === null || form === null || pending) return;
        const parsed = placementExecutorInput(form, executor.settings.updatedAt, compatibilityValue);
        if ("error" in parsed) {
            setResult({ ok: false, message: parsed.error });
            return;
        }
        const input = parsed.input as { minimumGainHours: number; noticeLeadHours: number; alwaysOnPolicy: HostingPlacementAlwaysOnPolicy };
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
            setCompatibilityValue(settings.maximumRelocationsPerDay);
            setResult({ ok: true, message: settings.enabled ? "Saved. Automatic placement is on." : "Saved. Automatic placement is off." });
        } catch (cause) {
            if (cause instanceof ControlPlaneAdminError && cause.code === "stale_interaction") {
                // Someone else saved first: show their settings rather than overwrite them.
                try {
                    // A read already under way may predate their save, so this one starts after it.
                    const fresh = await reads.fresh();
                    setExecutor(fresh);
                    setForm(placementExecutorForm(fresh.settings));
                    setCompatibilityValue(fresh.settings.maximumRelocationsPerDay);
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
                    Saved: at least {settings.minimumGainHours} pair-h/week each · always-on servers: {lowerFirst(alwaysOnPolicyLabel(settings.alwaysOnPolicy))} · {settings.noticeLeadHours} h notice
                </p>
                {executor !== null && <ExecutorStatus executor={executor} />}
                <form onSubmit={(event) => void save(event)} className="mt-5">
                    <label className="flex items-center gap-3 text-sm text-foreground">
                        <input type="checkbox" name="enabled" checked={form.enabled} disabled={pending} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="size-4 accent-crimson" />
                        Relocate servers automatically
                    </label>
                    {form.enabled && !settings.enabled && <p className="mt-2 text-xs text-amber-200">Saving turns automatic relocation on. Each move stops the game for a few minutes and changes the server&apos;s address and game port.</p>}
                    {!form.enabled && settings.enabled && <p className="mt-2 text-xs text-foreground-muted">Saving turns it off: announced moves are cancelled and their notices withdrawn; a relocation already running finishes.</p>}
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
                <PlacementLiveMoves relocations={executor?.relocations ?? []} />
            </>}
        </section>
    );
}

// Labels start a sentence; mid-sentence only their first letter drops, keeping "VPSs" intact.
function lowerFirst(text: string) {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

/** What the executor is doing now: its one move under way, if any, how many moves were queued recently and who waits to retry. */
function ExecutorStatus({ executor }: { executor: HostingAdminPlacementExecutor }) {
    const status = executor.status;
    // An older control plane sends no status; the moves list still shows what it is doing.
    if (typeof status !== "object" || status === null) return null;
    const active = activePlacementRelocation(executor);
    const progress = active === null ? null : placementRelocationProgress(active);
    const standing = active === null ? null : placementMoveStanding(active, progress);
    const backoffs = placementBackoffs(executor);
    return (
        <>
            <p className="mt-1 text-xs text-foreground-muted">
                {active === null
                    ? status.activeRelocationId !== null ? "A move is under way" : "No move under way"
                    : standing === "announced"
                        ? <>Announced: <span className="text-foreground">{active.displayName}</span> moves <LocalDateTime value={active.scheduledAt} /></>
                        : standing === "moving"
                            ? <>Moving now: <span className="text-foreground">{active.displayName}</span> ({shortServiceName(active.fromServiceName)} → {shortServiceName(active.toServiceName)}){progress?.step && <>, {placementMoveStepLabel(progress.step).toLowerCase()}</>}</>
                            : <>{STANDING_LABELS[standing!]}: <span className="text-foreground">{active.displayName}</span>, {lowerFirst(placementMoveStandingNote(standing!)!)}{standing === "returning" && <> ({shortServiceName(active.fromServiceName)})</>}</>}
                {" · "}{placementMovesQueuedLabel(status.queuedInLast24Hours)}
            </p>
            {backoffs.length > 0 && (
                <ul aria-label="Servers waiting to retry" className="mt-1 space-y-0.5 text-xs text-foreground-muted">
                    {backoffs.map((backoff) => (
                        <li key={backoff.serverId}>
                            Waiting to retry: <span className="text-foreground">{backoff.displayName}</span> until <LocalDateTime value={backoff.until} />{backoff.reason !== null && <> ({backoff.reason})</>}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

function PlacementLiveMoves({ relocations }: { relocations: readonly HostingPlacementRelocation[] }) {
    const ordered = useMemo(() => orderPlacementRelocations(relocations), [relocations]);
    return (
        <div className="mt-6">
            <h3 className="font-display text-xl font-semibold text-foreground">Live moves</h3>
            <p className="mt-1 text-xs text-foreground-muted">Moves under way first, then recent ones; times are in your time zone.</p>
            {ordered.length === 0
                ? <div className="mt-3 border border-white/10"><Empty>No automatic relocations yet.</Empty></div>
                : <ul className="mt-3 divide-y divide-white/10 border border-white/10">{ordered.map((relocation) => <LiveMove key={relocation.relocationId} relocation={relocation} />)}</ul>}
        </div>
    );
}

function LiveMove({ relocation }: { relocation: HostingPlacementRelocation }) {
    const progress = placementRelocationProgress(relocation);
    const standing = placementMoveStanding(relocation, progress);
    const standingLabel = STANDING_LABELS[standing];
    const duration = progress !== null && !isActivePlacementRelocation(relocation) ? placementRelocationDuration(progress) : null;
    const explanation = relocation.errorCode === null ? null : placementRelocationErrorLabel(relocation.errorCode);
    return (
        <li className="p-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-gold">{relocation.displayName}</span>
                <span className="font-mono text-foreground-muted" title={`${relocation.fromServiceName} → ${relocation.toServiceName}`}>
                    {shortServiceName(relocation.fromServiceName)} → <span className="text-foreground">{shortServiceName(relocation.toServiceName)}</span>
                </span>
                <span className="text-foreground-muted">{hostingRegionLabel(relocation.targetRegion)}</span>
                <span className="text-foreground-muted" title={relocation.mode === "announced" ? "Announced on the server's page, then moved after the notice lead time." : "Moved while the server was stopped."}>{relocation.mode === "announced" ? "Announced" : "Offline"}</span>
                <span className="font-mono text-foreground" title="Co-online pair-hours per week this move saves.">{formatPlacementGain(relocation.gainPairHoursPerWeek)}</span>
                <span className={`${badgeClass} ${STATE_BADGES[relocation.state] ?? STATE_BADGES.cancelled}`}>{placementRelocationStateLabel(relocation.state)}</span>
                {duration !== null && <span className="text-foreground-muted">Took {duration}</span>}
            </div>
            {standingLabel !== undefined && <p className="mt-2 text-amber-200">{standingLabel}: {lowerFirst(placementMoveStandingNote(standing)!)}</p>}
            {progress === null
                // An older control plane sends no progress: the move's own times stand in for the track.
                ? <p className="mt-2 text-foreground-muted">Scheduled <LocalDateTime value={relocation.scheduledAt} /> · queued <LocalDateTime value={relocation.queuedAt} empty="—" /> · completed <LocalDateTime value={relocation.completedAt} empty="—" /></p>
                : <MoveTrack name={relocation.displayName} steps={placementRelocationTrack(relocation, progress)} />}
            {relocation.errorCode !== null && (
                <p className="mt-2 text-red-200">{explanation ?? "The move ended with an error."} <span className="font-mono text-foreground-muted">{relocation.errorCode}</span></p>
            )}
        </li>
    );
}

/** The move's stops as an ordered list: each says its phase in words, and the one under way is the current step. */
function MoveTrack({ name, steps }: { name: string; steps: readonly PlacementTrackStep[] }) {
    return (
        <ol aria-label={`${name}: move steps`} className="mt-2 flex flex-wrap items-stretch gap-1">
            {steps.map((step, index) => {
                const phase = TRACK_PHASES[step.phase];
                return (
                    <Fragment key={step.id}>
                        {index > 0 && <li aria-hidden="true" className="self-center text-foreground-dim">→</li>}
                        <li aria-current={step.phase === "current" ? "step" : undefined} className={`min-w-0 border px-2 py-1 ${phase.className}`}>
                            <span className="flex items-center gap-1 font-medium">
                                {step.phase === "done" && <Check aria-hidden="true" className="size-3 text-emerald-300" />}
                                {step.label}<span className="sr-only">: {phase.label}</span>
                            </span>
                            {step.reachedAt !== null && <span className="block font-mono text-[0.62rem] text-foreground-muted"><LocalTime value={step.reachedAt} /></span>}
                            {step.note !== null && <span className="block max-w-48 text-[0.62rem] text-foreground-muted">{step.note}</span>}
                            {step.warnings.map((warning) => (
                                <span key={warning.minutes} className="block text-[0.62rem] text-foreground-muted">
                                    {warning.minutes} min: {warning.label}{warning.sentAt !== null && <> <LocalTime value={warning.sentAt} /></>}
                                </span>
                            ))}
                        </li>
                    </Fragment>
                );
            })}
        </ol>
    );
}
