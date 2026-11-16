"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useId } from "react";
import { Check, CircleAlert, LoaderCircle, Minus } from "lucide-react";
import type { BuildChangeJob, BuildStepId, BuildStepState } from "../../../../supabase/functions/_shared/server-build-contract";

/** Shows the ordered steps of one update with a progress bar, live status, the restore point and any failure. */
export function ServerUpdateProgress({ job }: { job: BuildChangeJob }) {
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
    const active = job.steps.find(step => step.state === "active" || step.state === "failed");
    const valueText = job.state === "succeeded" ? t("serverUpdate.complete") : t("serverUpdate.stepOfTotal", { done: job.completedSteps + (active?.state === "active" ? 1 : 0), total: job.totalSteps, phase: active ? labels[active.id] : "" });
    const percent = job.state === "succeeded" ? 100 : Math.min(100, Math.round((job.completedSteps / job.totalSteps) * 100));
    return <section aria-labelledby={headingId} className="w-full space-y-3 rounded-md border border-white/10 p-4">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
            {job.initiatedBy === "automatic" ? (version ? t("serverUpdate.automaticUpdateTo", { version }) : t("serverUpdate.automaticUpdate"))
                : job.initiatedBy === "administrator" ? (version ? t("serverUpdate.hostingSupportIsInstallingVersion", { version }) : t("serverUpdate.hostingSupportIsInstallingABuild"))
                    : version ? t("serverUpdate.updatingToVersion", { version }) : t("serverUpdate.updateProgress")}
        </h3>
        {(job.previousVersion !== null || version !== null) && <p className="text-sm text-foreground-muted" aria-label={t("serverUpdate.updateProgress")}>
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
            {active ? `${labels[active.id]}: ${states[active.state]}` : job.state === "succeeded" ? t("serverUpdate.complete") : job.progress}
        </p>
        <p role="status" aria-live="polite" className="text-sm text-foreground-muted">{job.state === "failed" || job.state === "cancelled" ? "" : job.progress}</p>
        {job.backup !== null && <p className="text-sm text-foreground-muted">{t("serverUpdate.backupCreatedBeforeTheUpdateRestoreItAnyTimeFromBackups")}</p>}
        {job.state === "succeeded" && <p className="text-sm font-medium text-foreground">{job.progress}</p>}
        {job.state === "failed" && <div role="alert" className="space-y-1 rounded-md border border-red-400/40 bg-red-400/[0.07] p-3 text-sm">
            <p className="font-semibold text-red-200">{t("serverUpdate.theUpdateDidNotFinish")}</p>
            {job.failureMessage && <p className="text-foreground">{job.failureMessage}</p>}
            {job.nextStep && <p className="text-foreground-muted">{job.nextStep}</p>}
        </div>}
        {job.state === "cancelled" && <p role="status" className="text-sm text-foreground-muted">{t("serverUpdate.theUpdateWasCancelled")}</p>}
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
