"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, History, LoaderCircle, Minus } from "lucide-react";
import { changeServerBuild, readServerBuildOptions, readServerBuildStatus } from "@/app/servers/server-build-actions";
import type { BuildChangeJob, BuildOption, BuildOptions, BuildStatus, BuildStepId, BuildStepState } from "../../../../supabase/functions/_shared/server-build-contract";
import { WorkspaceCard, workspaceBadgeClass, workspaceNoticeClass } from "./server-workspace-ui";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = `${button} !border-gold !bg-gold !font-semibold !text-background hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold`;
const ACTIVE_JOB_STATES = new Set(["queued", "running", "retry-wait"]);
const POLL_INTERVAL_MILLISECONDS = 3_000;
const POLL_DEADLINE_MILLISECONDS = 15 * 60_000;
const LATEST = "latest";

type Choice = typeof LATEST | string;

// Adds a watched job without replacing an unchanged set.
function withJob(current: ReadonlySet<string>, jobId: string) {
    return current.has(jobId) ? current : new Set(current).add(jobId);
}

/**
 * Lets an owner pick the public game-server version, rolling back to an earlier one or returning to Latest,
 * and follows the resulting change step by step. Renders nothing where the control plane offers no choice.
 */
export function ManagedServerVersion({ serverId, expectedUpdatedAt, canEdit }: { serverId: string; expectedUpdatedAt: string; canEdit: boolean }) {
    const { t } = useTranslations("managed-server");
    const router = useRouter();
    const groupId = useId();
    const [options, setOptions] = useState<BuildOptions | null>(null);
    const [status, setStatus] = useState<BuildStatus | null>(null);
    const [choice, setChoice] = useState<Choice | null>(null);
    const [acknowledged, setAcknowledged] = useState(false);
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState("");
    const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set());
    const [pollVersion, setPollVersion] = useState(0);
    const [progressError, setProgressError] = useState("");
    const request = useRef<{ choice: Choice; expectedUpdatedAt: string; requestId: string } | null>(null);
    const followed = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const loadOptions = useCallback(async () => {
        const next = await readServerBuildOptions(serverId);
        if (mounted.current) setOptions(next);
    }, [serverId]);
    // A refreshed page carries a new revision, so the offered versions and what runs are read again.
    useEffect(() => { if (canEdit) void loadOptions(); }, [canEdit, loadOptions, expectedUpdatedAt]);

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
                    if (followed.current) { followed.current = false; router.refresh(); void loadOptions(); }
                    return;
                }
            }
            if (Date.now() < deadline) timer = setTimeout(poll, POLL_INTERVAL_MILLISECONDS);
            else setProgressError(t("serverVersion.progressChecksPausedRefreshToCheckAgain"));
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [serverId, canEdit, pollVersion, router, loadOptions, t]);

    const job = status?.job ?? null;
    const busy = job !== null && ACTIVE_JOB_STATES.has(job.state);
    // Older outcomes are history: only jobs running now or followed during this page session are reported.
    const shownJob = job !== null && (busy || watched.has(job.jobId)) ? job : null;
    if (!canEdit || options === null || (!options.selectable && shownJob === null)) return null;

    const latest = options.latestVersion;
    // Latest is selectable only while the control plane offers it as an installable option.
    const latestOffered = options.options.some(option => option.isLatest);
    const installed = options.installedVersion;
    const currentChoice: Choice = options.pinnedVersion ?? LATEST;
    const versions = options.options.filter(option => !option.isLatest || option.isPinned);
    const selected: Choice = choice ?? currentChoice;
    const changed = selected !== currentChoice;
    const target: BuildOption | undefined = selected === LATEST ? options.options.find(option => option.isLatest) : options.options.find(option => option.buildId === selected);
    const targetVersion = selected === LATEST ? latest : target?.version ?? null;
    const restarts = selected === LATEST ? latest !== installed : target?.isInstalled === false;
    const needsAcknowledgement = restarts && target?.requiresSaveAcknowledgement === true;
    const canSubmit = changed && options.selectable && !busy && !pending && targetVersion !== null && (!needsAcknowledgement || acknowledged);

    function choose(next: Choice) {
        setChoice(next === currentChoice ? null : next);
        setAcknowledged(false);
        setMessage("");
    }

    async function submit() {
        if (!canSubmit || options === null) return;
        setPending(true);
        setMessage("");
        // A retry after an uncertain answer keeps the same request, so it can never queue a second change.
        if (request.current?.choice !== selected || request.current.expectedUpdatedAt !== expectedUpdatedAt) {
            request.current = { choice: selected, expectedUpdatedAt, requestId: crypto.randomUUID() };
        }
        const result = await changeServerBuild({
            serverId, buildId: selected === LATEST ? null : selected, expectedUpdatedAt,
            acknowledgeSaveRisk: acknowledged, requestId: request.current.requestId,
        }).catch(() => ({ ok: false as const, rejected: false, message: t("serverBuild.theVersionChangeCouldNotBeConfirmedCheckProgressOrTryAgain") }));
        if (!mounted.current) return;
        setPending(false);
        setMessage(result.message);
        if (result.rejected === true) request.current = null;
        if (!result.ok) return;
        request.current = null;
        setChoice(null);
        setAcknowledged(false);
        if (result.jobId) {
            const queuedJobId = result.jobId;
            setWatched(current => withJob(current, queuedJobId));
            followed.current = true;
            setPollVersion(value => value + 1);
        } else {
            router.refresh();
            void loadOptions();
        }
    }

    return <WorkspaceCard headingId={`${groupId}-heading`} title={t("serverVersion.serverVersion")} icon={History}
        description={t("serverVersion.chooseWhichPublicVersionOfTheGameServerRunsYour")}>
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                {installed !== null && <p className="font-medium text-foreground">{t("serverVersion.runningVersion", { version: installed })}</p>}
                {installed !== null && installed === latest && <span className={workspaceBadgeClass}>{t("serverVersion.latest")}</span>}
                {latest !== null && installed !== latest && <p className="text-foreground-muted">{t("serverVersion.latestAvailableVersion", { version: latest })}</p>}
            </div>
            {options.pinnedVersion === null
                ? <p className="text-sm leading-6 text-foreground-muted">{t("serverVersion.followingLatestNewPublicReleasesAreInstalledAutomaticallyDuring")}</p>
                : <p role="status" className={workspaceNoticeClass}>{t("serverVersion.automaticUpdatesArePausedThisServerStaysOnVersionUntilYou", { version: options.pinnedVersion })}</p>}
            {options.selectable && <fieldset disabled={busy || pending} className="space-y-2">
                <legend className="mb-2 text-sm font-semibold text-foreground">{t("serverVersion.publicVersions")}</legend>
                {latest !== null && <VersionChoice name={groupId} value={LATEST} checked={selected === LATEST} onChoose={choose} disabled={!latestOffered}
                    title={t("serverVersion.latestVersion", { version: latest })} description={t("serverVersion.followTheNewestPublicReleaseAutomaticUpdatesApplyToFuture")}
                    badges={[installed === latest ? t("serverVersion.runningNow") : null, options.pinnedVersion === null ? t("serverVersion.selected") : null]} />}
                {versions.map(option => <VersionChoice key={option.buildId} name={groupId} value={option.buildId} checked={selected === option.buildId} onChoose={choose}
                    title={option.version}
                    description={option.direction === "older" ? t("serverVersion.olderThanTheVersionRunningNow") : option.direction === "newer" ? t("serverVersion.newerThanTheVersionRunningNow") : t("serverVersion.sameVersionAsTheOneRunningNow")}
                    note={option.saveCompatibility === "verified" ? t("serverVersion.verifiedToReadYourCampaign") : t("serverVersion.compatibilityWithYourCurrentCampaignHasNotBeenVerified")}
                    badges={[option.isLatest ? t("serverVersion.latest") : null, option.isInstalled ? t("serverVersion.runningNow") : null, option.isPinned ? t("serverVersion.selected") : null]} />)}
            </fieldset>}
            {changed && targetVersion !== null && <div role="group" aria-labelledby={`${groupId}-confirm`} className="space-y-3 rounded-md border border-gold/30 bg-gold/[0.04] p-4">
                <h3 id={`${groupId}-confirm`} className="text-sm font-semibold text-foreground">
                    {selected === LATEST ? t("serverVersion.returnToTheLatestVersion") : restarts ? t("serverVersion.installVersionQuestion", { version: targetVersion }) : t("serverVersion.stayOnVersionQuestion", { version: targetVersion })}
                </h3>
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-foreground-muted">
                    {restarts ? <>
                        <li>{t("serverVersion.theGameSavesAndStopsIfItIsRunningABackupIs", { version: targetVersion })}</li>
                        <li>{t("serverVersion.aBackupIsCreatedFirstAndKeptUnderBackupsSoYou")}</li>
                        {installed !== null && <li>{t("serverVersion.ifTheGameDoesNotStartOnTheNewVersionYourServer", { current: installed })}</li>}
                    </> : <li>{t("serverVersion.thisDoesNotRestartTheServerVersionKeepsRunningOnlyAutomatic", { version: installed ?? targetVersion })}</li>}
                    <li>{selected === LATEST ? t("serverVersion.automaticUpdatesResumeForFutureReleasesAfterThisChange") : t("serverVersion.automaticUpdatesArePausedForThisServerUntilYouSelectLatest")}</li>
                </ul>
                {needsAcknowledgement && <div role="alert" className="space-y-2 rounded-md border border-red-400/40 bg-red-400/[0.07] p-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-red-200"><CircleAlert aria-hidden="true" className="size-4 shrink-0" />{t("serverVersion.olderVersionsMayNotLoadNewerSaves")}</p>
                    <p className="text-sm leading-6 text-foreground">{t("serverVersion.yourCampaignWasLastSavedByVersionHasNotBeenVerifiedToRead", { current: installed ?? "", version: targetVersion })}</p>
                    <label className="flex items-start gap-2 text-sm text-foreground">
                        <input type="checkbox" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 accent-gold" />
                        <span>{t("serverVersion.iUnderstandTheRiskToMyCampaignAndWantToContinue")}</span>
                    </label>
                </div>}
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!canSubmit} className={primaryButton} onClick={() => void submit()}>
                        {pending ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{t("serverVersion.working")}</>
                            : selected === LATEST ? t("serverVersion.returnToLatest") : restarts ? t("serverVersion.installVersion", { version: targetVersion }) : t("serverVersion.stayOnVersion", { version: targetVersion })}
                    </button>
                    <button type="button" disabled={pending} className={button} onClick={() => { setChoice(null); setAcknowledged(false); setMessage(""); }}>{t("serverVersion.cancel")}</button>
                </div>
            </div>}
            <p role="status" aria-live="polite" className={message ? "text-sm text-foreground" : "sr-only"}>{message}</p>
            {shownJob !== null && <VersionProgress job={shownJob} pinnedVersion={options.pinnedVersion} />}
            {progressError && <p role="status" className="text-sm text-foreground-muted">{progressError} <button type="button" className="underline" onClick={() => setPollVersion(value => value + 1)}>{t("serverVersion.checkProgress")}</button></p>}
        </div>
    </WorkspaceCard>;
}

/** One selectable version: a radio row whose badges name what is running, selected or latest. */
function VersionChoice({ name, value, checked, onChoose, title, description, note, badges, disabled = false }: {
    name: string; value: Choice; checked: boolean; onChoose: (value: Choice) => void; title: string; description: string; note?: string; badges: (string | null)[]; disabled?: boolean;
}) {
    return <label className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 hover:border-gold/40 ${checked ? "border-gold/50 bg-gold/5" : "border-white/15"}`}>
        <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChoose(value)} className="mt-1 accent-gold" />
        <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">{title}{badges.filter((badge): badge is string => badge !== null).map(badge => <span key={badge} className={workspaceBadgeClass}>{badge}</span>)}</span>
            <span className="mt-0.5 block text-xs leading-5 text-foreground-muted">{description}</span>
            {note && <span className="block text-xs leading-5 text-foreground-muted">{note}</span>}
        </span>
    </label>;
}

/** The ordered steps of one version change with a progress bar, live status, the restore point and any failure. */
function VersionProgress({ job, pinnedVersion }: { job: BuildChangeJob; pinnedVersion: string | null }) {
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
    return <section aria-labelledby={headingId} className="space-y-3 rounded-md border border-white/10 p-4">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
            {job.initiatedBy === "automatic" ? (version ? t("serverVersion.automaticUpdateTo", { version }) : t("serverVersion.automaticUpdate"))
                : job.initiatedBy === "administrator" ? (version ? t("serverVersion.hostingSupportIsChangingTo", { version }) : t("serverVersion.hostingSupportIsChangingYourVersion"))
                    : version ? t("serverVersion.changingToVersion", { version }) : t("serverVersion.versionChangeProgress")}
        </h3>
        <div role="progressbar" aria-labelledby={headingId} aria-valuemin={0} aria-valuemax={job.totalSteps} aria-valuenow={job.state === "succeeded" ? job.totalSteps : job.completedSteps} aria-valuetext={valueText}
            className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${job.state === "failed" || job.state === "cancelled" ? "bg-red-400" : "bg-gold"}`} style={{ width: `${percent}%` }} />
        </div>
        <ol className="space-y-1.5">
            {job.steps.map(step => <li key={step.id} aria-current={step.state === "active" ? "step" : undefined} className={`flex items-center gap-2 text-sm ${step.state === "pending" || step.state === "skipped" ? "text-foreground-muted" : "text-foreground"}`}>
                <StepIcon state={step.state} />
                <span className={step.state === "skipped" ? "line-through" : ""}>{labels[step.id]}</span>
                <span className="sr-only">{states[step.state]}</span>
            </li>)}
        </ol>
        <p role="status" aria-live="polite" className="text-sm text-foreground-muted">{job.state === "failed" || job.state === "cancelled" ? "" : job.progress}</p>
        {job.backup !== null && <p className="text-sm text-foreground-muted">{t("serverVersion.backupCreatedBeforeTheChangeRestoreItAnyTimeFromBackups")}</p>}
        {job.state === "succeeded" && <p className="text-sm font-medium text-foreground">{t("serverVersion.nowRunningVersion", { version: version ?? "" })}{pinnedVersion !== null && ` ${t("serverVersion.automaticUpdatesArePausedSelectLatestToResume")}`}</p>}
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
