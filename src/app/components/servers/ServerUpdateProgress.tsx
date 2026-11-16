"use client";

import { useTranslations } from "@/app/lib/localization/client";
import type { Translator } from "@/app/lib/localization/types";

import { useId } from "react";
import { Check, CircleAlert, LoaderCircle, Minus } from "lucide-react";
import type { BuildUpdateJob, BuildStepId, BuildStepState } from "../../../../supabase/functions/_shared/server-build-contract";
import type { UpdateProgressError } from "./use-server-update-progress";

/** The owner-facing text for each reason update progress cannot be shown. */
const ERROR_KEYS: Record<UpdateProgressError, string> = {
    unavailable: "serverUpdate.progressIsUnavailableTheUpdateMayStillBeRunning",
    paused: "serverUpdate.progressChecksPausedRefreshToCheckAgain",
};

/** Shows the ordered steps of one update with a progress bar, live status, the restore point and any failure. */
export function ServerUpdateProgress({ job }: { job: BuildUpdateJob }) {
    const { t } = useTranslations("managed-server");
    const headingId = useId();
    const version = job.targetVersion;
    const labels: Record<BuildStepId, string> = {
        queued: t("serverUpdate.stepQueued"),
        stopping: t("serverUpdate.stepStopping"),
        backup: t("serverUpdate.stepBackup"),
        installing: version ? t("serverUpdate.stepInstalling", { version }) : t("serverUpdate.stepInstallingUpdate"),
        starting: t("serverUpdate.stepStarting"),
        verifying: t("serverUpdate.stepVerifying"),
    };
    const states: Record<BuildStepState, string> = {
        done: t("serverUpdate.stateDone"), active: t("serverUpdate.stateInProgress"), pending: t("serverUpdate.stateWaiting"),
        skipped: t("serverUpdate.stateNotNeeded"), failed: t("serverUpdate.stateFailed"),
    };
    const succeeded = job.state === "succeeded";
    const stoppedShort = job.state === "failed" || job.state === "cancelled";
    const doneCount = succeeded ? job.totalSteps : job.completedSteps;
    const currentStep = job.steps.find(step => step.state === "active" || step.state === "failed");
    const valueText = progressValueText(job, currentStep, labels, t);
    const percent = Math.min(100, Math.round((doneCount / job.totalSteps) * 100));
    const activeStatus = currentStep ? `${labels[currentStep.id]}: ${states[currentStep.state]}` : null;
    return <section aria-labelledby={headingId} className="w-full space-y-3 rounded-md border border-white/10 p-4">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
            {updateHeading(job, t)}
        </h3>
        {(job.previousVersion !== null || version !== null) && <p className="text-sm text-foreground-muted" aria-label={t("serverUpdate.updateProgress")}>
            {job.previousVersion ?? "—"} <span aria-hidden="true">→</span> {version ?? "—"}
        </p>}
        <div role="progressbar" aria-labelledby={headingId} aria-valuemin={0} aria-valuemax={job.totalSteps} aria-valuenow={doneCount} aria-valuetext={valueText}
            className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${stoppedShort ? "bg-red-400" : "bg-gold"}`} style={{ width: `${percent}%` }} />
        </div>
        <ol className="space-y-1.5" aria-live="polite" aria-atomic="false">
            {job.steps.map(step => <li key={step.id} aria-current={step.state === "active" ? "step" : undefined} className={`flex items-center gap-2 text-sm ${step.state === "pending" || step.state === "skipped" ? "text-foreground-muted" : "text-foreground"}`}>
                <StepIcon state={step.state} />
                <span className={step.state === "skipped" ? "line-through" : ""}>{labels[step.id]}</span>
                <span className="sr-only">{states[step.state]}</span>
            </li>)}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">
            {liveStatusText(job, activeStatus, t)}
        </p>
        <p role="status" aria-live="polite" className="text-sm text-foreground-muted">{stoppedShort ? "" : job.progress}</p>
        {job.backup !== null && <p className="text-sm text-foreground-muted">{t("serverUpdate.backupCreatedBeforeTheUpdateRestoreItAnyTimeFromBackups")}</p>}
        {succeeded && <p className="text-sm font-medium text-foreground">{job.progress}</p>}
        {job.state === "failed" && <div role="alert" className="space-y-1 rounded-md border border-red-400/40 bg-red-400/[0.07] p-3 text-sm">
            <p className="font-semibold text-red-200">{t("serverUpdate.theUpdateDidNotFinish")}</p>
            {job.failureMessage && <p className="text-foreground">{job.failureMessage}</p>}
            {job.nextStep && <p className="text-foreground-muted">{job.nextStep}</p>}
        </div>}
        {job.state === "cancelled" && <p role="status" className="text-sm text-foreground-muted">{t("serverUpdate.theUpdateWasCancelled")}</p>}
    </section>;
}

/** Shows the followed update's progress and/or why its progress cannot be shown; renders nothing when neither exists. */
export function ServerUpdateStatus({ job, error }: { job: BuildUpdateJob | null; error: UpdateProgressError | null }) {
    if (job === null && error === null) return null;
    return <>
        {job !== null && <ServerUpdateProgress job={job} />}
        {error !== null && <ServerUpdateProgressError error={error} />}
    </>;
}

/** Tells the owner why update progress cannot be shown right now, as a polite status. */
function ServerUpdateProgressError({ error }: { error: UpdateProgressError }) {
    const { t } = useTranslations("managed-server");
    return <p role="status" aria-live="polite" className="max-w-xl text-sm leading-6 text-foreground-muted">{t(ERROR_KEYS[error])}</p>;
}

/** Describes the progress bar's value: completion, or the step being worked on out of the total and its name. */
function progressValueText(
    job: BuildUpdateJob,
    currentStep: BuildUpdateJob["steps"][number] | undefined,
    labels: Record<BuildStepId, string>,
    t: Translator["t"],
): string {
    if (job.state === "succeeded") return t("serverUpdate.complete");
    if (currentStep === undefined) return t("serverUpdate.stepOfTotal", { done: job.completedSteps, total: job.totalSteps, phase: "" });
    // An active step is the one being worked on, so it counts; a failed one does not.
    const done = job.completedSteps + (currentStep.state === "active" ? 1 : 0);
    return t("serverUpdate.stepOfTotal", { done, total: job.totalSteps, phase: labels[currentStep.id] });
}

/** Picks the screen-reader status line: the current step and its state, completion, or the job's own progress text. */
function liveStatusText(job: BuildUpdateJob, activeStatus: string | null, t: Translator["t"]): string {
    if (activeStatus !== null) return activeStatus;
    if (job.state === "succeeded") return t("serverUpdate.complete");
    return job.progress;
}

/** Names who started the update and, when known, the version it installs. */
function updateHeading(job: BuildUpdateJob, t: Translator["t"]): string {
    const version = job.targetVersion;
    if (job.initiatedBy === "automatic") {
        if (version) return t("serverUpdate.automaticUpdateTo", { version });
        return t("serverUpdate.automaticUpdate");
    }
    if (job.initiatedBy === "administrator") {
        if (version) return t("serverUpdate.hostingSupportIsInstallingVersion", { version });
        return t("serverUpdate.hostingSupportIsInstallingABuild");
    }
    if (version) return t("serverUpdate.updatingToVersion", { version });
    return t("serverUpdate.updateProgress");
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
