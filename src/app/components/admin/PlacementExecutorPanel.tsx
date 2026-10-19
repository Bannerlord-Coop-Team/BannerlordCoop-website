"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Empty } from "@/app/components/admin/ControlPlanePresentation";
import { LocalDateTime, LocalTime } from "@/app/components/admin/LocalDateTime";
import { ControlPlaneAdminError, requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import {
    formatPlacementGain,
    PLACEMENT_EXECUTOR_DESCRIPTION,
    PLACEMENT_EXECUTOR_ENABLE_CONFIRMATION,
    placementExecutorErrorMessage,
    placementExecutorLegacyValues,
    placementExecutorSwitchInput,
    placementRelocationStateLabel,
    type PlacementExecutorLegacyValues,
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
import type { HostingAdminPlacementExecutor, HostingPlacementExecutorSettings, HostingPlacementRelocation } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";

const badgeClass = "inline-flex w-fit border px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em]";
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
 * Automatic placement as one switch, with what it is doing and its recent moves. Its rules are fixed by the
 * control plane, so there is nothing else to configure. Switching it on moves customer servers by itself, so
 * that asks for confirmation; switching it off saves at once.
 */
export function PlacementExecutorPanel() {
    const [executor, setExecutor] = useState<HostingAdminPlacementExecutor | null>(null);
    const [loadError, setLoadError] = useState("");
    const [reload, setReload] = useState(0);
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
    // Polls, the stale-save reload and Retry share one read at a time.
    const [reads] = useState(() => createPlacementExecutorReads(readExecutor));
    // Legacy settings as the latest read of any kind gave them: a switch sends each back unchanged.
    const [legacy, setLegacy] = useState<PlacementExecutorLegacyValues>({});

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
                // Only what the executor is doing: the switch stays as read, so a switch is still checked against it.
                if (!cancelled) {
                    setExecutor((current) => current === null ? current : { ...current, status: fresh.status, relocations: fresh.relocations });
                    setLegacy(placementExecutorLegacyValues(fresh.settings));
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
            setLegacy(placementExecutorLegacyValues(value.settings));
            setLoadError("");
        }, (cause: unknown) => {
            if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "The executor settings could not be loaded.");
        });
        return () => { cancelled = true; };
    }, [reload, reads]);

    async function toggle(enabled: boolean) {
        if (executor === null || pending) return;
        if (enabled && !window.confirm(PLACEMENT_EXECUTOR_ENABLE_CONFIRMATION)) return;
        setPending(true);
        setResult(null);
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            const settings = await requestControlPlaneAdmin<HostingPlacementExecutorSettings>({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "set-placement-executor",
                input: placementExecutorSwitchInput(enabled, executor.settings.updatedAt, legacy),
            });
            setExecutor((current) => current === null ? current : { ...current, settings });
            setLegacy(placementExecutorLegacyValues(settings));
            setResult({ ok: true, message: settings.enabled ? "Automatic placement is on." : "Automatic placement is off." });
        } catch (cause) {
            if (cause instanceof ControlPlaneAdminError && cause.code === "stale_interaction") {
                // Someone else switched it first: show their state rather than overwrite it.
                try {
                    // A read already under way may predate their switch, so this one starts after it.
                    const fresh = await reads.fresh();
                    setExecutor(fresh);
                    setLegacy(placementExecutorLegacyValues(fresh.settings));
                } catch { /* The stale message below still asks to try again. */ }
            }
            setResult({ ok: false, message: placementExecutorErrorMessage(cause) });
        } finally {
            setPending(false);
        }
    }

    const settings = executor?.settings ?? null;
    return (
        <section className={`border bg-surface p-5 ${settings?.enabled ? "border-crimson/50" : "border-white/10"}`} aria-labelledby="placement-executor-heading">
            <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">Automatic executor</p>
            <h2 id="placement-executor-heading" className="mt-1 font-display text-3xl font-semibold text-foreground">Automatic placement</h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-foreground-muted">{PLACEMENT_EXECUTOR_DESCRIPTION}</p>
            {loadError && <p role="alert" className="mt-4 border-l-2 border-crimson bg-crimson/10 px-3 py-2 text-xs text-red-200">{loadError} <button type="button" className="ml-2 underline" onClick={() => setReload((value) => value + 1)}>Retry</button></p>}
            {settings === null && !loadError && <p className="mt-4 text-xs text-foreground-muted" role="status">Loading automatic placement…</p>}
            {executor !== null && settings !== null && <>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button type="button" role="switch" aria-checked={settings.enabled} aria-label="Automatic placement" disabled={pending}
                        onClick={() => void toggle(!settings.enabled)}
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-wait disabled:opacity-60 ${settings.enabled ? "border-crimson bg-crimson" : "border-white/20 bg-white/10"}`}>
                        <span aria-hidden="true" className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                    <span className={`font-label text-xs font-semibold uppercase tracking-[0.12em] ${settings.enabled ? "text-red-100" : "text-foreground-muted"}`}>
                        {settings.enabled ? "On · relocating servers automatically" : "Off · nothing moves automatically"}
                    </span>
                    {pending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-foreground-muted" />}
                    {settings.updatedAt !== null && <span className="text-xs text-foreground-dim">{settings.enabled ? "On" : "Off"} since <LocalDateTime value={settings.updatedAt} /></span>}
                </div>
                {result && <p role={result.ok ? "status" : "alert"} className={`mt-3 border-l-2 px-3 py-2 text-xs ${result.ok ? "border-emerald-500 bg-emerald-500/10 text-emerald-200" : "border-crimson bg-crimson/10 text-red-200"}`}>{result.message}</p>}
                <ExecutorStatus executor={executor} />
                <PlacementLiveMoves relocations={executor.relocations} />
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
                <span className="text-foreground-muted" title={relocation.mode === "announced" ? "Announced on the server's page, then moved after an hour's notice." : "Moved while the server was stopped."}>{relocation.mode === "announced" ? "Announced" : "Offline"}</span>
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

/**
 * The move's stops as an ordered list of equal columns: each says its phase in words, notes and times wrap
 * inside it, and the one under way is the current step. A narrow panel scrolls the track instead of cutting it.
 */
function MoveTrack({ name, steps }: { name: string; steps: readonly PlacementTrackStep[] }) {
    return (
        <div className="mt-2 overflow-x-auto pb-1">
            <ol aria-label={`${name}: move steps`} className="grid gap-x-3" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(5.5rem, 1fr))` }}>
                {steps.map((step, index) => {
                    const phase = TRACK_PHASES[step.phase];
                    return (
                        <li key={step.id} aria-current={step.phase === "current" ? "step" : undefined}
                            className={`relative min-w-0 border px-2 py-1 break-words ${phase.className}`}>
                            <span className="flex items-start gap-1 font-medium">
                                {step.phase === "done" && <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-emerald-300" />}
                                <span className="min-w-0">{step.label}<span className="sr-only">: {phase.label}</span></span>
                            </span>
                            {step.reachedAt !== null && <span className="block font-mono text-[0.62rem] text-foreground-muted"><LocalTime value={step.reachedAt} /></span>}
                            {step.note !== null && <span className="block text-[0.62rem] text-foreground-muted">{step.note}</span>}
                            {step.warnings.map((warning) => (
                                <span key={warning.minutes} className="block text-[0.62rem] text-foreground-muted">
                                    {warning.minutes} min: {warning.label}{warning.sentAt !== null && <> <LocalTime value={warning.sentAt} /></>}
                                </span>
                            ))}
                            {/* A chevron drawn in the gap before the stop: no text, and it never widens a column. */}
                            {index > 0 && <span aria-hidden="true" className="absolute top-1/2 -left-2.25 size-1.5 -translate-y-1/2 rotate-45 border-t border-r border-foreground-dim" />}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
