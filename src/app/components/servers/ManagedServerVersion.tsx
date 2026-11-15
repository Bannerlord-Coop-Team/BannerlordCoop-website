"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, History, LoaderCircle, Minus } from "lucide-react";
import { readServerBuildStatus } from "@/app/servers/server-build-actions";
import type { BuildChangeJob, BuildStatus, BuildStepId, BuildStepState } from "../../../../supabase/functions/_shared/server-build-contract";
import { WorkspaceCard } from "./server-workspace-ui";

const ACTIVE_JOB_STATES = new Set(["queued", "running", "retry-wait"]);
const POLL_INTERVAL_MILLISECONDS = 3_000;
const POLL_DEADLINE_MILLISECONDS = 15 * 60_000;

// Adds a watched job without replacing an unchanged set.
function withJob(current: ReadonlySet<string>, jobId: string) {
    return current.has(jobId) ? current : new Set(current).add(jobId);
}

/** Shows the owner a running server update step by step on Settings, and nothing while no update runs.
 *  Servers always run their release channel's current build, so there is no version to choose. */
export function ManagedServerVersion({ serverId, expectedUpdatedAt, canEdit }: { serverId: string; expectedUpdatedAt: string; canEdit: boolean }) {
    const { t } = useTranslations("managed-server");
    const router = useRouter();
    const groupId = useId();
    const [status, setStatus] = useState<BuildStatus | null>(null);
    const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set());
    const [pollVersion, setPollVersion] = useState(0);
    const [progressError, setProgressError] = useState("");
    const followed = useRef(false);

    useEffect(() => {
        if (!canEdit) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const deadline = Date.now() + POLL_DEADLINE_MILLISECONDS;
        // Follows the current or latest update job until it ends, reporting a paused check instead of failing silently.
        async function poll() {
            const next = await readServerBuildStatus(serverId);
            if (cancelled) return;
            if (next === null) setProgressError(t("serverVersion.progressIsUnavailableTheChangeMayStillBeRunning"));
            else {
                setStatus(next);
                setProgressError("");
                const job = next.job;
                if (job !== null && ACTIVE_JOB_STATES.has(job.state)) {
                    followed.current = true;
                    setWatched(current => withJob(current, job.jobId));
                } else {
                    // Every page load lands here with nothing running; only a job this page followed needs a refresh.
                    if (followed.current) { followed.current = false; router.refresh(); }
                    return;
                }
            }
            if (Date.now() < deadline) timer = setTimeout(poll, POLL_INTERVAL_MILLISECONDS);
            else setProgressError(t("serverVersion.progressChecksPausedRefreshToCheckAgain"));
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [serverId, canEdit, expectedUpdatedAt, pollVersion, router, t]);

    const job = status?.job ?? null;
    const busy = job !== null && ACTIVE_JOB_STATES.has(job.state);
    // Older outcomes are history: only jobs running now or followed during this page session are reported.
    const shownJob = job !== null && (busy || watched.has(job.jobId)) ? job : null;
    if (!canEdit || shownJob === null) return null;

    return <WorkspaceCard headingId={`${groupId}-heading`} title={t("serverVersion.serverVersion")} icon={History}>
        <div className="space-y-5">
            <VersionProgress job={shownJob} />
            {progressError && <p role="status" className="text-sm text-foreground-muted">{progressError} <button type="button" className="underline" onClick={() => setPollVersion(value => value + 1)}>{t("serverVersion.checkProgress")}</button></p>}
        </div>
    </WorkspaceCard>;
}

/** Shows the ordered steps of one update with a progress bar, live status, the restore point and any failure. */
export function VersionProgress({ job }: { job: BuildChangeJob }) {
    const { t } = useTranslations("managed-server");
    const headingId = useId();
    const version = job.targetVersion;
    const labels: Record<BuildStepId, string> = {
        queued: t("serverVersion.stepQueued"),
        stopping: t("serverVersion.stepStopping"),
        backup: t("serverVersion.stepBackup"),
        installing: version ? t("serverVersion.stepInstalling", { version }) : t("serverVersion.stepInstallingSelected"),
        starting: t("serverVersion.stepStarting"),
        verifying: t("serverVersion.stepVerifying"),
    };
    const states: Record<BuildStepState, string> = {
        done: t("serverVersion.stateDone"), active: t("serverVersion.stateInProgress"), pending: t("serverVersion.stateWaiting"),
        skipped: t("serverVersion.stateNotNeeded"), failed: t("serverVersion.stateFailed"),
    };
    const active = job.steps.find(step => step.state === "active" || step.state === "failed");
    const finished = job.state === "succeeded" || job.state === "failed" || job.state === "cancelled";
    const valueText = job.state === "succeeded" ? t("serverVersion.complete") : t("serverVersion.stepOfTotal", { done: job.completedSteps + (active?.state === "active" ? 1 : 0), total: job.totalSteps, phase: active ? labels[active.id] : "" });
    const percent = job.state === "succeeded" ? 100 : Math.min(100, Math.round((job.completedSteps / job.totalSteps) * 100));
    return <section aria-labelledby={headingId} className="w-full space-y-3 rounded-md border border-white/10 p-4">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
            {job.initiatedBy === "automatic" ? (version ? t("serverVersion.automaticUpdateTo", { version }) : t("serverVersion.automaticUpdate"))
                : job.initiatedBy === "administrator" ? (version ? t("serverVersion.hostingSupportIsChangingTo", { version }) : t("serverVersion.hostingSupportIsChangingYourVersion"))
                    : version ? t("serverVersion.changingToVersion", { version }) : t("serverVersion.versionChangeProgress")}
        </h3>
        {(job.previousVersion !== null || version !== null) && <p className="text-sm text-foreground-muted" aria-label={t("serverVersion.versionChangeProgress")}>
            {job.previousVersion ?? "—"} <span aria-hidden="true">→</span> {version ?? "—"}
        </p>}
        <div role="progressbar" aria-labelledby={headingId} aria-valuemin={0} aria-valuemax={job.totalSteps} aria-valuenow={job.state === "succeeded" ? job.totalSteps : job.completedSteps} aria-valuetext={valueText}
            className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${job.state === "failed" || job.state === "cancelled" ? "bg-red-400" : "bg-gold"}`} style={{ width: `${percent}%` }} />
        </div>
        <ol className="space-y-1.5" aria-live="polite" aria-atomic="false">
            {job.steps.map(step => <li key={step.id} aria-current={step.state === "active" ? "step" : undefined} className={`flex items-center gap-2 text-sm ${step.state === "pending" || step.state === "skipped" ? "text-foreground-muted" : "text-foreground"}`}>
                <StepIcon state={step.state} />
                <span className={step.state === "skipped" ? "line-through" : ""}>{labels[step.id]}</span>
                <span className="sr-only">{states[step.state]}</span>
            </li>)}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">
            {active ? `${labels[active.id]}: ${states[active.state]}` : job.state === "succeeded" ? t("serverVersion.complete") : job.progress}
        </p>
        <p role="status" aria-live="polite" className="text-sm text-foreground-muted">{job.state === "failed" || job.state === "cancelled" ? "" : job.progress}</p>
        {job.backup !== null && <p className="text-sm text-foreground-muted">{t("serverVersion.backupCreatedBeforeTheChangeRestoreItAnyTimeFromBackups")}</p>}
        {job.state === "succeeded" && <p className="text-sm font-medium text-foreground">{job.progress}</p>}
        {job.state === "failed" && <div role="alert" className="space-y-1 rounded-md border border-red-400/40 bg-red-400/[0.07] p-3 text-sm">
            <p className="font-semibold text-red-200">{t("serverVersion.theVersionChangeDidNotFinish")}</p>
            {job.failureMessage && <p className="text-foreground">{job.failureMessage}</p>}
            {job.nextStep && <p className="text-foreground-muted">{job.nextStep}</p>}
        </div>}
        {finished && job.state === "cancelled" && <p role="status" className="text-sm text-foreground-muted">{t("serverVersion.theVersionChangeWasCancelled")}</p>}
    </section>;
}

/** Marks a step's state with a shape as well as a color, so progress never relies on color alone. */
function StepIcon({ state }: { state: BuildStepState }) {
    const base = "size-4 shrink-0";
    if (state === "done") return <Check aria-hidden="true" className={`${base} text-gold`} />;
    if (state === "active") return <LoaderCircle aria-hidden="true" className={`${base} animate-spin text-gold motion-reduce:animate-none`} />;
    if (state === "failed") return <CircleAlert aria-hidden="true" className={`${base} text-red-300`} />;
    if (state === "skipped") return <Minus aria-hidden="true" className={`${base} text-foreground-muted`} />;
    return <span aria-hidden="true" className="inline-block size-4 shrink-0 rounded-full border border-white/25" />;
}
