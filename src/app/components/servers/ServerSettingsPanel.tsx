"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { renameLiveServer } from "@/app/servers/name-actions";
import { setServerVisibility } from "@/app/servers/server-visibility-actions";
import { changeServerRelease, readServerReleaseStatus } from "@/app/servers/server-release-actions";
import { saveServerSettings } from "@/app/servers/server-settings-actions";
import { HOSTING_MAINTENANCE_SLOTS, HOSTING_TIME_ZONE, type MaintenanceSlot, type OwnerSettingsMutation } from "../../../../supabase/functions/_shared/server-settings-contract";
import type { ReleaseChannel, ReleaseStatus } from "../../../../supabase/functions/_shared/server-release-contract";
import { CircleAlert, Globe2, LockKeyhole } from "lucide-react";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40";

type Visibility = "private" | "public";
type VisibilityAccess = { serverId: string; expectedUpdatedAt: string; canEdit: boolean };

export function ServerSettingsPanel({ name, visibility, renameServerId, visibilityAccess, releaseAccess, settingsAccess }: {
    settingsAccess?: VisibilityAccess & { maintenanceSlot?: string; timezone?: string };
    releaseAccess?: VisibilityAccess & { channel: ReleaseChannel };
    name: string; visibility?: Visibility; renameServerId?: string; visibilityAccess?: VisibilityAccess;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [nameState, setNameState] = useState({ source: name, saved: name, draft: name });
    const [visibilityState, setVisibilityState] = useState({ source: visibility, draft: visibility });
    const [channelState, setChannelState] = useState({ source: releaseAccess?.channel, draft: releaseAccess?.channel });
    const [maintenanceState, setMaintenanceState] = useState({ source: settingsAccess?.maintenanceSlot, draft: settingsAccess?.maintenanceSlot });
    const settingsRequest = useRef<(OwnerSettingsMutation & { requestId: string }) | null>(null);
    const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus | null>(null);
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
        async function poll() {
            const status = await readServerReleaseStatus(releaseServerId!).catch(() => null);
            if (cancelled) return;
            const matches = status && (!expectedJob.current || status.job?.jobId === expectedJob.current);
            if (matches) {
                setReleaseStatus(status);
                setProgressError("");
                if (!status.job || ["succeeded", "failed", "cancelled"].includes(status.job.state)) {
                    router.refresh();
                    return;
                }
            } else setProgressError("Update progress is unavailable. The operation may still be running.");
            if (Date.now() < deadline) timer = setTimeout(poll, 4_000);
            else setProgressError("Progress checks paused. Refresh to check whether the release change finished.");
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [releaseServerId, canReadRelease, pollVersion, router]);
    const updateBusy = releaseStatus?.job != null && ["queued", "running", "retry-wait"].includes(releaseStatus.job.state);
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

    function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending || updateBusy || !dirty || (nameDirty && !nameState.draft.trim())) return;
        if (visibilityDirty && visibilityState.draft === "public" && !window.confirm("Make this server discoverable in the public directory with its game address? Visibility does not grant management access or change game connection permissions.")) return;
        setMessage("");
        startTransition(async () => {
            const messages: string[] = [];
            let expectedUpdatedAt = settingsAccess?.expectedUpdatedAt ?? visibilityAccess?.expectedUpdatedAt ?? releaseAccess?.expectedUpdatedAt;
            try {
                if (nameDirty && renameServerId) {
                    const form = new FormData();
                    form.set("serverId", renameServerId);
                    form.set("displayName", nameState.draft.trim());
                    const result = await renameLiveServer(form);
                    if (!result.ok) { setMessage(result.error); return; }
                    setNameState(current => ({ ...current, saved: result.displayName, draft: result.displayName }));
                    messages.push("Server name saved.");
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
                    messages.push(result.message);
                    if (result.rejected) settingsRequest.current = null;
                    if (!result.ok || !result.updatedAt) { setMessage(messages.join(" ")); return; }
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
                    if (result.ok) { request.current = null; expectedUpdatedAt = result.updatedAt; }
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
                        expectedJob.current = result.jobId;
                        releaseRequest.current = null;
                        setReleaseStatus({ serverId: releaseAccess.serverId, releaseChannel: channelState.draft,
                            job: { jobId: result.jobId, state: "queued", progress: "Waiting to begin" } });
                        setPollVersion(value => value + 1);
                    }
                }
                setMessage(messages.join(" "));
            } catch {
                if (channelDirty) { expectedJob.current = null; setPollVersion(value => value + 1); }
                setMessage([...messages, "The update could not be confirmed. Retry or refresh to check the current settings."].join(" "));
            } finally {
                router.refresh();
            }
        });
    }

    return <section aria-labelledby="server-settings-heading" className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="border-b border-white/10 p-5">
            <h2 id="server-settings-heading" className="text-base font-semibold">Server settings</h2>
            <p className="mt-1 text-sm leading-6 text-foreground-muted">Changes apply only when you save.</p>
        </div>
        <form onSubmit={save}>
        <div className="max-w-3xl space-y-5 p-5">
            <div>
                <label htmlFor="settings-server-name" className="text-sm font-medium">Server name</label>
                <input id="settings-server-name" disabled={!canRename || pending || updateBusy} required minLength={renameServerId ? undefined : 3} maxLength={renameServerId ? 80 : 48} value={nameState.draft} onChange={event => { setNameState(current => ({ ...current, draft: event.target.value })); setMessage(""); }} className="mt-2 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50" />
                <p className="mt-2 text-xs leading-5 text-foreground-muted">{canRename ? "The server display name." : "Renaming is unavailable for this server or your access level."}</p>
            </div>
            {settingsAccess && <div>
                <label htmlFor="settings-maintenance-window" className="text-sm font-medium">Maintenance window</label>
                <select id="settings-maintenance-window" aria-describedby="maintenance-window-help" value={hasMaintenance ? maintenanceState.draft : ""} disabled={!canChangeSettings || pending || updateBusy}
                    onChange={event => { setMaintenanceState(current => ({ ...current, draft: event.target.value })); setMessage(""); }}
                    className="mt-2 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm disabled:opacity-50">
                    {!hasMaintenance && <option value="">Maintenance window unavailable</option>}
                    {HOSTING_MAINTENANCE_SLOTS.map(slot => <option key={slot} value={slot}>{slot.replace("-", "–")} Central Time</option>)}
                </select>
                <p id="maintenance-window-help" className="mt-2 text-sm leading-6 text-foreground-muted">Daily automatic updates use Central Time ({HOSTING_TIME_ZONE}) and follow daylight-saving changes. Maintenance starts within the first 15 minutes of the selected window. Saving this preference does not restart the server.</p>
                {!hasMaintenance && <p role="status" className="mt-2 text-sm text-foreground-muted">Maintenance settings could not be loaded. Refresh or contact hosting support.</p>}
                {hasMaintenance && !settingsAccess.canEdit && <p className="mt-2 text-xs text-foreground-muted">Only the server owner can change hosting settings.</p>}
            </div>}
            {releaseAccess && <div>
                <label htmlFor="settings-release-channel" className="text-sm font-medium">Release channel</label>
                <select id="settings-release-channel" aria-describedby="release-channel-help" value={channelState.draft} disabled={!releaseAccess.canEdit || pending || updateBusy}
                    onChange={event => { setChannelState(current => ({ ...current, draft: event.target.value as ReleaseChannel })); setMessage(""); }}
                    className="mt-2 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm disabled:opacity-50">
                    <option value="stable">Stable</option><option value="nightly">Nightly</option>
                </select>
                <p id="release-channel-help" className="mt-2 text-sm leading-6 text-foreground-muted">Saving a different channel stops the server, backs up the campaign, installs that release, and starts the server. Connected players will be disconnected.</p>
                <div role="status" aria-live="polite" className="mt-3 text-sm text-foreground-muted">
                    {releaseStatus?.job && <p>{releaseStatus.job.state === "succeeded" ? "Release update completed." : releaseStatus.job.state === "failed" ? "Release update failed. Check server status before retrying or contact hosting support." : releaseStatus.job.state === "cancelled" ? "Release update was cancelled." : releaseStatus.job.progress}</p>}
                    {progressError && <p>{progressError} <button type="button" className="underline" onClick={() => setPollVersion(value => value + 1)}>Check progress</button></p>}
                </div>
            </div>}
            <fieldset disabled={!canChangeVisibility || pending}>
                <legend className="text-sm font-medium">Directory visibility</legend>
                <p className="mt-2 text-sm leading-6 text-foreground-muted">Public visibility allows this server to appear in the public directory with its game address. Visibility does not grant management access or change game connection permissions.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {([{ value: "private", title: "Private", description: "Hidden from the public directory.", icon: LockKeyhole }, { value: "public", title: "Public", description: "Include this server in the public directory.", icon: Globe2 }] as const).map(({ value, title, description, icon: Icon }) => <label key={value} className={`flex items-start gap-3 rounded-md border p-4 ${!canChangeVisibility || pending ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${visibilityState.draft === value ? "border-gold/50 bg-gold/5" : "border-white/10"}`}>
                        <input disabled={!canChangeVisibility || pending} type="radio" name="settings-visibility" value={value} checked={visibilityState.draft === value} onChange={() => { setVisibilityState(current => ({ ...current, draft: value })); setMessage(""); }} className="mt-1 accent-gold" />
                        <span><span className="flex items-center gap-2 text-sm font-medium"><Icon className={`size-4 ${visibilityState.draft === value ? "text-gold" : "text-foreground-muted"}`} aria-hidden="true" />{title}</span><span className="mt-2 block text-xs leading-5 text-foreground-muted">{description}</span></span>
                    </label>)}
                </div>
                <p className="mt-3 text-xs leading-5 text-foreground-muted">{visibility ? canChangeVisibility ? "Choose a preference, then save settings." : "Only the server owner can change visibility." : "Directory visibility is unavailable for this server."}</p>
            </fieldset>
        </div>
        <div className={`sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t bg-surface px-5 py-4 ${dirty ? "border-gold/60 bg-linear-to-r from-gold/15 to-gold/5" : "border-white/10"}`}>
            <div className="min-w-0 basis-full text-sm sm:flex-1">
                <div role="status" aria-atomic="true">
                    {dirty ? <><p className="flex items-center gap-2 font-semibold text-gold"><CircleAlert className="size-5 shrink-0" aria-hidden="true" />Unsaved changes</p><p className="mt-1 text-foreground">Save settings to apply your changes.</p></> : <p className="text-foreground-muted">No pending changes</p>}
                </div>
                <p role="status" className={message ? "mt-2 text-foreground" : ""}>{message}</p>
            </div>
            {dirty && <div className="ml-auto flex gap-2"><button type="button" disabled={pending} className={button} onClick={() => { setNameState(current => ({ ...current, draft: current.saved })); setVisibilityState({ source: visibility, draft: visibility }); setChannelState({ source: releaseAccess?.channel, draft: releaseAccess?.channel }); setMaintenanceState({ source: settingsAccess?.maintenanceSlot, draft: settingsAccess?.maintenanceSlot }); setMessage(""); }}>Discard</button><button type="submit" disabled={pending || updateBusy || (nameDirty && !nameState.draft.trim())} className={`${button} !border-gold !bg-gold !font-semibold !text-background hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold`}>{pending ? "Saving…" : "Save settings"}</button></div>}
        </div>
        </form>
    </section>;
}
