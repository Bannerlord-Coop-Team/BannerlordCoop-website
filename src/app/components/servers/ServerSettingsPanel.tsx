"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MAX_SERVER_DISPLAY_NAME_LENGTH, validateServerDisplayName } from "@/app/lib/hosting/server-names";
import { managedServerNameMessage, managedServerNameProblem } from "@/app/servers/managed-server-name-validation";
import { renameLiveServer } from "@/app/servers/name-actions";
import { setServerVisibility } from "@/app/servers/server-visibility-actions";
import { changeServerRelease, readServerReleaseStatus } from "@/app/servers/server-release-actions";
import { saveServerSettings, type ServerSettingsField } from "@/app/servers/server-settings-actions";
import { HOSTING_MAINTENANCE_SLOTS, HOSTING_TIME_ZONE, type MaintenanceSlot, type OwnerSettingsMutation } from "../../../../supabase/functions/_shared/server-settings-contract";
import type { ReleaseChannel, ReleaseStatus } from "../../../../supabase/functions/_shared/server-release-contract";
import { CircleAlert, Globe2, LockKeyhole } from "lucide-react";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40";
const ACTIVE_RELEASE_JOB_STATES = new Set(["queued", "running", "retry-wait"]);

// Adds a watched release job without replacing an unchanged set.
function withReleaseJob(current: ReadonlySet<string>, jobId: string) {
    return current.has(jobId) ? current : new Set(current).add(jobId);
}

type Visibility = "private" | "public";
type VisibilityAccess = { serverId: string; expectedUpdatedAt: string; canEdit: boolean };

// Presents authorized settings drafts and localized mutation feedback.
export function ServerSettingsPanel({ name, visibility, renameServerId, visibilityAccess, releaseAccess, settingsAccess }: {
    settingsAccess?: VisibilityAccess & { maintenanceSlot?: string; timezone?: string };
    releaseAccess?: VisibilityAccess & { channel: ReleaseChannel };
    name: string; visibility?: Visibility; renameServerId?: string; visibilityAccess?: VisibilityAccess;
}) {
    const { t } = useTranslations("managed-server");
    const router = useRouter();
    const [saving, setSaving] = useState(false);
    const [refreshing, startRefresh] = useTransition();
    const pending = saving || refreshing;
    const savingRef = useRef(false);
    const nameInput = useRef<HTMLInputElement>(null);
    const [nameState, setNameState] = useState({ source: name, saved: name, draft: name });
    const [nameTouched, setNameTouched] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<ServerSettingsField, string>>>({});
    const [visibilityState, setVisibilityState] = useState({ source: visibility, draft: visibility });
    const [channelState, setChannelState] = useState({ source: releaseAccess?.channel, draft: releaseAccess?.channel });
    const [maintenanceState, setMaintenanceState] = useState({ source: settingsAccess?.maintenanceSlot, draft: settingsAccess?.maintenanceSlot });
    const settingsRequest = useRef<(OwnerSettingsMutation & { requestId: string }) | null>(null);
    const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus | null>(null);
    const [watchedReleaseJobs, setWatchedReleaseJobs] = useState<ReadonlySet<string>>(() => new Set());
    const [pollVersion, setPollVersion] = useState(0);
    const [progressError, setProgressError] = useState("");
    const releaseRequest = useRef<{ serverId: string; releaseChannel: ReleaseChannel; expectedUpdatedAt: string; requestId: string } | null>(null);
    const expectedJob = useRef<string | null>(null);
    const releaseServerId = releaseAccess?.serverId;
    const canReadRelease = releaseAccess?.canEdit === true;
    useEffect(() => {
        if (!releaseServerId || !canReadRelease) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const deadline = Date.now() + 15 * 60_000;
        // Refreshes existing operation progress and reports localized connection feedback.
        async function poll() {
            const status = await readServerReleaseStatus(releaseServerId!).catch(() => null);
            if (cancelled) return;
            const matches = status && (!expectedJob.current || status.job?.jobId === expectedJob.current);
            if (matches) {
                setReleaseStatus(status);
                setProgressError("");
                // A job seen running on this page makes its eventual outcome worth reporting.
                const activeJobId = status.job && ACTIVE_RELEASE_JOB_STATES.has(status.job.state) ? status.job.jobId : null;
                if (activeJobId) setWatchedReleaseJobs(current => withReleaseJob(current, activeJobId));
                if (!status.job || ["succeeded", "failed", "cancelled"].includes(status.job.state)) {
                    router.refresh();
                    return;
                }
            } else setProgressError(t("settingsPanel.updateProgressIsUnavailableTheOperationMayStillBeRunning"));
            if (Date.now() < deadline) timer = setTimeout(poll, 4_000);
            else setProgressError(t("settingsPanel.progressChecksPausedRefreshToCheckWhetherTheReleaseChange"));
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [releaseServerId, canReadRelease, pollVersion, router]);
    const updateBusy = releaseStatus?.job != null && ACTIVE_RELEASE_JOB_STATES.has(releaseStatus.job.state);
    // Older outcomes are history: only report jobs requested or watched during this page session.
    const shownReleaseJob = releaseStatus?.job && (updateBusy || watchedReleaseJobs.has(releaseStatus.job.jobId)) ? releaseStatus.job : null;
    const [message, setMessage] = useState("");
    const request = useRef<{ serverId: string; visibility: Visibility; expectedUpdatedAt: string; requestId: string } | null>(null);
    // Refreshes from either header control update that field without discarding the other draft.
    if (nameState.source !== name) setNameState({ source: name, saved: name, draft: name });
    if (visibilityState.source !== visibility) setVisibilityState({ source: visibility, draft: visibility });
    if (channelState.source !== releaseAccess?.channel) setChannelState({ source: releaseAccess?.channel, draft: releaseAccess?.channel });
    if (maintenanceState.source !== settingsAccess?.maintenanceSlot) setMaintenanceState({ source: settingsAccess?.maintenanceSlot, draft: settingsAccess?.maintenanceSlot });
    const channelDirty = releaseAccess?.canEdit === true && channelState.draft !== releaseAccess.channel;
    const hasMaintenance = settingsAccess?.timezone === HOSTING_TIME_ZONE && HOSTING_MAINTENANCE_SLOTS.includes(settingsAccess.maintenanceSlot as MaintenanceSlot);
    const canChangeSettings = settingsAccess?.canEdit === true && hasMaintenance;
    const canRename = !!renameServerId || canChangeSettings;
    const canChangeVisibility = visibilityAccess?.canEdit === true && visibility !== undefined;
    const nameDirty = canRename && nameState.draft.trim() !== nameState.saved;
    const visibilityDirty = canChangeVisibility && visibilityState.draft !== visibility;
    const maintenanceDirty = canChangeSettings && maintenanceState.draft !== settingsAccess?.maintenanceSlot;
    const dirty = nameDirty || visibilityDirty || channelDirty || maintenanceDirty;
    const nameError = fieldErrors.displayName ?? (nameDirty && nameTouched ? nameProblem(nameState.draft) : null);

    // Checks a name draft with the rules its save path enforces, so problems appear beside the field.
    function nameProblem(value: string) {
        if (renameServerId) {
            const result = validateServerDisplayName(value, {
                required: t("name.required"),
                singleLine: t("name.singleLine"),
                tooLong: t("name.tooLong", { maximum: MAX_SERVER_DISPLAY_NAME_LENGTH }),
            });
            return result.ok ? null : result.error;
        }
        const problem = managedServerNameProblem(value.trim());
        return problem === null ? null : managedServerNameMessage(problem, t);
    }

    // Submits the existing settings operation and presents its outcome.
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (savingRef.current || pending || updateBusy || !dirty) return;
        if (nameDirty && nameProblem(nameState.draft) !== null) {
            setNameTouched(true);
            setFieldErrors({});
            nameInput.current?.focus();
            return;
        }
        if (visibilityDirty && visibilityState.draft === "public" && !window.confirm(t("settingsPanel.makeThisServerDiscoverableInThePublicDirectoryWithIts"))) return;
        savingRef.current = true;
        setSaving(true);
        setMessage("");
        setFieldErrors({});
        const messages: string[] = [];
        let changed = false;
        let expectedUpdatedAt = settingsAccess?.expectedUpdatedAt ?? visibilityAccess?.expectedUpdatedAt ?? releaseAccess?.expectedUpdatedAt;
        try {
            if (nameDirty && renameServerId) {
                const form = new FormData();
                form.set("serverId", renameServerId);
                form.set("displayName", nameState.draft.trim());
                const result = await renameLiveServer(form);
                if (!result.ok) { setMessage(result.error); return; }
                changed = true;
                setNameState(current => ({ ...current, saved: result.displayName, draft: result.displayName }));
                messages.push(t("settingsPanel.serverNameSaved"));
            }
            if (settingsAccess && canChangeSettings && ((nameDirty && !renameServerId) || maintenanceDirty)) {
                const patch = {
                    ...(nameDirty && !renameServerId ? { displayName: nameState.draft.trim() } : {}),
                    ...(maintenanceDirty ? { maintenanceSlot: maintenanceState.draft as MaintenanceSlot } : {}),
                };
                if (!settingsRequest.current || settingsRequest.current.serverId !== settingsAccess.serverId
                    || JSON.stringify(settingsRequest.current.patch) !== JSON.stringify(patch)) {
                    settingsRequest.current = { serverId: settingsAccess.serverId, expectedUpdatedAt: settingsAccess.expectedUpdatedAt, patch, requestId: crypto.randomUUID() };
                }
                const result = await saveServerSettings(settingsRequest.current);
                if (result.rejected) settingsRequest.current = null;
                if (!result.ok || !result.updatedAt) {
                    // A rejected field is explained beside that field rather than in the summary bar.
                    if (result.field) setFieldErrors({ [result.field]: result.message });
                    else messages.push(result.message);
                    setMessage(messages.join(" "));
                    return;
                }
                messages.push(result.message);
                changed = true;
                settingsRequest.current = null;
                expectedUpdatedAt = result.updatedAt;
            }
            if (visibilityDirty && visibilityAccess && visibilityState.draft) {
                if (!request.current || request.current.serverId !== visibilityAccess.serverId || request.current.visibility !== visibilityState.draft) {
                    request.current = { serverId: visibilityAccess.serverId, visibility: visibilityState.draft, expectedUpdatedAt: expectedUpdatedAt ?? visibilityAccess.expectedUpdatedAt, requestId: crypto.randomUUID() };
                }
                const result = await setServerVisibility(request.current);
                messages.push(result.message);
                if (result.rejected) request.current = null;
                if (result.ok) { request.current = null; changed = true; expectedUpdatedAt = result.updatedAt; }
                else { setMessage(messages.join(" ")); return; }
                // A receipt may be a replay. Only refreshed props establish the current visibility.
            }
            if (channelDirty && releaseAccess && channelState.draft && expectedUpdatedAt) {
                if (!releaseRequest.current || releaseRequest.current.releaseChannel !== channelState.draft || releaseRequest.current.serverId !== releaseAccess.serverId) {
                    releaseRequest.current = { serverId: releaseAccess.serverId, releaseChannel: channelState.draft, expectedUpdatedAt, requestId: crypto.randomUUID() };
                }
                const result = await changeServerRelease(releaseRequest.current);
                messages.push(result.message);
                if (result.rejected) releaseRequest.current = null;
                if (!result.ok) { expectedJob.current = null; setPollVersion(value => value + 1); }
                if (result.ok && result.jobId) {
                    changed = true;
                    expectedJob.current = result.jobId;
                    releaseRequest.current = null;
                    const jobId = result.jobId;
                    setWatchedReleaseJobs(current => withReleaseJob(current, jobId));
                    setReleaseStatus({ serverId: releaseAccess.serverId, releaseChannel: channelState.draft,
                        job: { jobId: result.jobId, state: "queued", progress: t("settingsPanel.waitingToBegin") } });
                    setPollVersion(value => value + 1);
                }
            }
            setMessage(messages.join(" "));
        } catch {
            if (channelDirty) { expectedJob.current = null; setPollVersion(value => value + 1); }
            setMessage([...messages, t("settingsPanel.theUpdateCouldNotBeConfirmedRetryOrRefreshTo")].join(" "));
        } finally {
            savingRef.current = false;
            setSaving(false);
            // Accepted changes wait for refreshed props before settling; failures refresh without holding "Saving…".
            if (changed) startRefresh(() => router.refresh());
            else router.refresh();
        }
    }

    // Restores every draft to the current settings and clears field problems.
    function discard() {
        setNameState(current => ({ ...current, draft: current.saved }));
        setVisibilityState({ source: visibility, draft: visibility });
        setChannelState({ source: releaseAccess?.channel, draft: releaseAccess?.channel });
        setMaintenanceState({ source: settingsAccess?.maintenanceSlot, draft: settingsAccess?.maintenanceSlot });
        setNameTouched(false);
        setFieldErrors({});
        setMessage("");
    }

    return <section aria-labelledby="server-settings-heading" className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="border-b border-white/10 p-5">
            <h2 id="server-settings-heading" className="text-base font-semibold">{t("settingsPanel.serverSettings")}</h2>
            <p className="mt-1 text-sm leading-6 text-foreground-muted">{t("settingsPanel.changesApplyOnlyWhenYouSave")}</p>
        </div>
        <form onSubmit={save} noValidate>
        <div className="max-w-3xl space-y-5 p-5">
            <div>
                <label htmlFor="settings-server-name" className="text-sm font-medium">{t("settingsPanel.serverName")}</label>
                <input id="settings-server-name" ref={nameInput} disabled={!canRename || pending || updateBusy} required minLength={renameServerId ? undefined : 3} maxLength={renameServerId ? 80 : 48} value={nameState.draft}
                    aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? "settings-server-name-error settings-server-name-help" : "settings-server-name-help"}
                    onChange={event => { setNameState(current => ({ ...current, draft: event.target.value })); setFieldErrors(current => ({ ...current, displayName: undefined })); setMessage(""); }}
                    onBlur={() => setNameTouched(true)}
                    className="mt-2 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-400" />
                {nameError && <p id="settings-server-name-error" role="alert" className="mt-2 text-sm text-red-200">{nameError}</p>}
                <p id="settings-server-name-help" className="mt-2 text-xs leading-5 text-foreground-muted">{canRename ? t("settingsPanel.theServerDisplayName") : t("settingsPanel.renamingIsUnavailableForThisServerOrYourAccessLevel")}</p>
            </div>
            {settingsAccess && <div>
                <label htmlFor="settings-maintenance-window" className="text-sm font-medium">{t("settingsPanel.maintenanceWindow")}</label>
                <select id="settings-maintenance-window" aria-describedby={fieldErrors.maintenanceSlot ? "maintenance-window-error maintenance-window-help" : "maintenance-window-help"} aria-invalid={fieldErrors.maintenanceSlot ? true : undefined}
                    value={hasMaintenance ? maintenanceState.draft : ""} disabled={!canChangeSettings || pending || updateBusy}
                    onChange={event => { setMaintenanceState(current => ({ ...current, draft: event.target.value })); setFieldErrors(current => ({ ...current, maintenanceSlot: undefined })); setMessage(""); }}
                    className="mt-2 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm disabled:opacity-50 aria-[invalid=true]:border-red-400">
                    {!hasMaintenance && <option value="">{t("settingsPanel.maintenanceWindowUnavailable")}</option>}
                    {HOSTING_MAINTENANCE_SLOTS.map(slot => <option key={slot} value={slot}>{t("settingsPanel.maintenanceSlot", { slot: slot.replace("-", "–") })}</option>)}
                </select>
                {fieldErrors.maintenanceSlot && <p id="maintenance-window-error" role="alert" className="mt-2 text-sm text-red-200">{fieldErrors.maintenanceSlot}</p>}
                <p id="maintenance-window-help" className="mt-2 text-sm leading-6 text-foreground-muted">{t("settingsPanel.maintenanceHelp", { timezone: HOSTING_TIME_ZONE })}</p>
                {!hasMaintenance && <p role="status" className="mt-2 text-sm text-foreground-muted">{t("settingsPanel.maintenanceSettingsCouldNotBeLoadedRefreshOrContactHosting")}</p>}
                {hasMaintenance && !settingsAccess.canEdit && <p className="mt-2 text-xs text-foreground-muted">{t("settingsPanel.onlyTheServerOwnerCanChangeHostingSettings")}</p>}
            </div>}
            {releaseAccess && <div>
                <label htmlFor="settings-release-channel" className="text-sm font-medium">{t("settingsPanel.releaseChannel")}</label>
                <select id="settings-release-channel" aria-describedby="release-channel-help" value={channelState.draft} disabled={!releaseAccess.canEdit || pending || updateBusy}
                    onChange={event => { setChannelState(current => ({ ...current, draft: event.target.value as ReleaseChannel })); setMessage(""); }}
                    className="mt-2 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm disabled:opacity-50">
                    <option value="stable">{t("settingsPanel.stable")}</option><option value="nightly">{t("settingsPanel.nightly")}</option>
                </select>
                <p id="release-channel-help" className="mt-2 text-sm leading-6 text-foreground-muted">{t("settingsPanel.savingADifferentChannelStopsTheServerBacksUpThe")}</p>
                <div role="status" aria-live="polite" className="mt-3 text-sm text-foreground-muted">
                    {shownReleaseJob && <p>{shownReleaseJob.state === "succeeded" ? t("settingsPanel.releaseUpdateCompleted") : shownReleaseJob.state === "failed" ? t("settingsPanel.theReleaseUpdateDidnTFinishYouCanTryAgainOnceTheServer") : shownReleaseJob.state === "cancelled" ? t("settingsPanel.releaseUpdateWasCancelled") : shownReleaseJob.progress}</p>}
                    {progressError && <p>{progressError} <button type="button" className="underline" onClick={() => setPollVersion(value => value + 1)}>{t("settingsPanel.checkProgress")}</button></p>}
                </div>
            </div>}
            <fieldset disabled={!canChangeVisibility || pending}>
                <legend className="text-sm font-medium">{t("settingsPanel.directoryVisibility")}</legend>
                <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("settingsPanel.publicVisibilityAllowsThisServerToAppearInThePublic")}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {([{ value: "private", title: t("settingsPanel.private"), description: t("settingsPanel.hiddenFromThePublicDirectory"), icon: LockKeyhole }, { value: "public", title: t("settingsPanel.public"), description: t("settingsPanel.includeThisServerInThePublicDirectory"), icon: Globe2 }] as const).map(({ value, title, description, icon: Icon }) => <label key={value} className={`flex items-start gap-3 rounded-md border p-4 ${!canChangeVisibility || pending ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${visibilityState.draft === value ? "border-gold/50 bg-gold/5" : "border-white/10"}`}>
                        <input disabled={!canChangeVisibility || pending} type="radio" name="settings-visibility" value={value} checked={visibilityState.draft === value} onChange={() => { setVisibilityState(current => ({ ...current, draft: value })); setMessage(""); }} className="mt-1 accent-gold" />
                        <span><span className="flex items-center gap-2 text-sm font-medium"><Icon className={`size-4 ${visibilityState.draft === value ? "text-gold" : "text-foreground-muted"}`} aria-hidden="true" />{title}</span><span className="mt-2 block text-xs leading-5 text-foreground-muted">{description}</span></span>
                    </label>)}
                </div>
                <p className="mt-3 text-xs leading-5 text-foreground-muted">{visibility ? canChangeVisibility ? t("settingsPanel.chooseAPreferenceThenSaveSettings") : t("settingsPanel.onlyTheServerOwnerCanChangeVisibility") : t("settingsPanel.directoryVisibilityIsUnavailableForThisServer")}</p>
            </fieldset>
        </div>
        {/* Root overflow clipping defeats position: sticky, so unsaved changes pin the bar to the viewport instead. */}
        {dirty && <div aria-hidden="true" className="h-28 sm:h-20" />}
        <div data-unsaved-bar={dirty ? "pinned" : undefined} className={dirty ? "fixed inset-x-0 bottom-0 z-30 border-t border-gold/60 bg-surface shadow-[0_-12px_32px_rgba(0,0,0,0.45)]" : "rounded-b-lg border-t border-white/10 bg-surface"}>
            <div className={dirty ? "bg-linear-to-r from-gold/15 to-gold/5" : ""}>
                <div className={`flex flex-wrap items-center justify-between gap-3 py-4 ${dirty ? "site-container" : "px-5"}`}>
                    <div className="min-w-0 basis-full text-sm sm:flex-1">
                        <div role="status" aria-atomic="true">
                            {dirty ? <><p className="flex items-center gap-2 font-semibold text-gold"><CircleAlert className="size-5 shrink-0" aria-hidden="true" />{t("settingsPanel.unsavedChanges")}</p><p className="mt-1 text-foreground">{t("settingsPanel.saveSettingsToApplyYourChanges")}</p></> : <p className="text-foreground-muted">{t("settingsPanel.noPendingChanges")}</p>}
                        </div>
                        <p role="status" className={message ? "mt-2 text-foreground" : ""}>{message}</p>
                    </div>
                    {dirty && <div className="ml-auto flex gap-2"><button type="button" disabled={pending} className={button} onClick={discard}>{t("settingsPanel.discard")}</button><button type="submit" disabled={pending || updateBusy} className={`${button} !border-gold !bg-gold !font-semibold !text-background hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold`}>{pending ? t("settingsPanel.saving") : t("settingsPanel.saveSettings")}</button></div>}
                </div>
            </div>
        </div>
        </form>
    </section>;
}
