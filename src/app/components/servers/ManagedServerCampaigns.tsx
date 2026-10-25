"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { changeManagedServerCampaign, listManagedServerCampaigns } from "@/app/servers/managed-server-campaign-actions";
import { useSaveDeletion } from "./use-save-deletion";
import { DisabledControlHint } from "./DisabledControlHint";
import { fileButtonClass, fileIconButtonClass, filePrimaryButtonClass } from "./server-file-styles";
import { workspaceBadgeClass, workspaceListClass } from "./server-workspace-ui";
import type { CampaignPage } from "../../../../supabase/functions/_shared/server-campaign-contract";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";

type Campaigns = Omit<CampaignPage, "nextCursor">;

export function ManagedServerCampaigns({ userId, serverId, status, canDelete = false }: { userId: string; serverId: string; status: OwnerFileStatus | null; canDelete?: boolean }) {
    const router = useRouter();
    const [campaigns, setCampaigns] = useState<Campaigns | null>(null);
    const [loadError, setLoadError] = useState("");
    const [message, setMessage] = useState("");
    const [pending, startTransition] = useTransition();
    const [confirming, setConfirming] = useState(false);
    const [resetting, setResetting] = useState<{ previousSaveId: string | null; since: number } | null>(null);
    const resettingRef = useRef<{ previousSaveId: string | null; since: number } | null>(null);
    const [version, setVersion] = useState(0);
    const deletion = useSaveDeletion(userId, serverId, () => { setVersion(value => value + 1); router.refresh(); });
    const dialogRef = useRef<HTMLDialogElement>(null);
    // Retries reuse the request so the control plane replays instead of queueing twice.
    const requests = useRef<{ key: string; requestId: string } | null>(null);
    const statusUpdatedAt = status?.updatedAt ?? null;
    const stopped = status !== null && status.observedGameState === "stopped" && ["stopped", "awaiting-save"].includes(status.operationState);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            let result: Awaited<ReturnType<typeof listManagedServerCampaigns>> | null = null;
            try { result = await listManagedServerCampaigns(serverId, userId); } catch { result = null; }
            if (cancelled) return;
            if (!result?.ok) { setLoadError(result?.message ?? "The campaign list could not be loaded. Try again."); return; }
            setCampaigns(result.campaigns); setLoadError("");
            // A reset is done when the selection moved to a different, freshly seeded campaign.
            const reset = resettingRef.current;
            if (!reset) return;
            if (result.campaigns.activeSaveId !== null && result.campaigns.activeSaveId !== reset.previousSaveId) {
                resettingRef.current = null; setResetting(null); requests.current = null;
                setMessage("Your fresh campaign is ready. Start the server when you want to play it.");
            } else if (Date.now() - reset.since > 10 * 60_000) {
                resettingRef.current = null; setResetting(null);
                setMessage("The new campaign is taking longer than expected. Check the Jobs list or refresh this page later.");
            }
        })();
        return () => { cancelled = true; };
    }, [serverId, userId, statusUpdatedAt, version]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (confirming && dialog && !dialog.open) dialog.showModal();
        if (!confirming && dialog?.open) dialog.close();
    }, [confirming]);

    useEffect(() => {
        if (!resetting) return;
        const timer = window.setInterval(() => { setVersion((value) => value + 1); router.refresh(); }, 5_000);
        return () => window.clearInterval(timer);
    }, [resetting, router]);

    function requestId(key: string) {
        if (requests.current?.key === key) return requests.current.requestId;
        const next = { key, requestId: crypto.randomUUID() };
        requests.current = next;
        return next.requestId;
    }

    function change(input: { action: "select-save"; saveId: string } | { action: "reset-campaign" }) {
        if (!campaigns || !status) return;
        const body = { ...input, serverId, expectedUpdatedAt: campaigns.updatedAt };
        const key = JSON.stringify(body);
        setMessage("");
        startTransition(async () => {
            let response: Awaited<ReturnType<typeof changeManagedServerCampaign>> | null = null;
            try { response = await changeManagedServerCampaign({ requestId: requestId(key), ...body }, userId); } catch { response = null; }
            if (!response?.ok) {
                if (!response || response.refresh || response.notSubmitted) requests.current = null;
                setMessage(response?.message ?? "Connection interrupted. Try again; a repeated request is replayed, not duplicated.");
                if (!response || response.refresh) setVersion((value) => value + 1);
                return;
            }
            requests.current = null;
            if ("selection" in response) {
                setMessage("Campaign selected. It loads the next time the server starts.");
                setVersion((value) => value + 1); router.refresh();
            } else {
                setConfirming(false);
                const reset = { previousSaveId: campaigns.activeSaveId, since: Date.now() };
                resettingRef.current = reset; setResetting(reset);
                setMessage(response.reset.outcome === "existing" ? "That new-campaign request was already accepted. Preparing your fresh campaign…" : "Preparing your fresh campaign. This takes about a minute…");
            }
        });
    }

    function remove(campaign: Campaigns["items"][number]) {
        const page = campaigns;
        if (!canDelete || campaign.importedBy !== "owner" || !stopped || busy || deletion.blocksDeletion || !page) return;
        if (!window.confirm(`Delete campaign "${campaign.displayName}"? Type the exact campaign name in the next prompt to confirm.`)) return;
        const confirmationText = window.prompt(`Type the exact campaign name to delete "${campaign.displayName}".`);
        if (confirmationText !== campaign.displayName) {
            setMessage("The campaign name did not match, so nothing was deleted.");
            return;
        }
        setMessage("");
        deletion.begin({ serverId, saveId: campaign.saveId, expectedUpdatedAt: page.updatedAt, confirmationText, requestId: crypto.randomUUID() });
    }

    const busy = pending || resetting !== null || deletion.busy;
    const stopHint = status === null ? "Campaign changes are unavailable until the server status loads." : stopped ? null : "Stop the server to switch campaigns or start a new one.";
    // A server that never started has no campaign yet; the control plane refuses a reset until its first Start creates one.
    const noCampaignYet = campaigns !== null && campaigns.items.length === 0;
    const newCampaignDisabled = busy || !stopped || !campaigns || noCampaignYet;
    const newCampaignHint = status === null ? "Campaign changes are unavailable until the server status loads." : !stopped ? "Stop the server before starting a new campaign." : busy ? "Finish the current campaign operation first." : !campaigns ? "Campaigns are still loading." : "This server has no campaign yet. Starting it creates a fresh one.";

    return <div>
        {loadError && <p role="alert" className="mb-3 text-sm text-red-300">{loadError}</p>}
        {campaigns && <ul className={workspaceListClass}>
            {campaigns.items.length === 0 && <li className="px-4 py-3 text-sm text-foreground-muted">No campaigns are registered yet. Starting the server creates a fresh one.</li>}
            {campaigns.items.map((campaign) => {
                const active = campaign.saveId === campaigns.activeSaveId;
                return <li key={campaign.saveId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-2 text-sm font-medium"><span className="truncate">{campaign.displayName}</span>{active && <span className={workspaceBadgeClass}>Selected</span>}</p>
                        <p className="mt-1 text-sm text-foreground-muted">{campaign.importedBy === "system" ? "Created by hosting" : "Imported"} · {new Date(campaign.createdAt).toLocaleDateString()} · {formatBytes(campaign.byteSize)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {!active && <DisabledControlHint disabled={busy || !stopped} message={busy ? "Finish the current campaign operation first." : "Stop the server before switching campaigns."}>
                            <button type="button" className={fileButtonClass} disabled={busy || !stopped} onClick={() => change({ action: "select-save", saveId: campaign.saveId })}>Use this campaign</button>
                        </DisabledControlHint>}
                        {canDelete && campaign.importedBy === "owner" && <DisabledControlHint disabled={busy || deletion.blocksDeletion || !stopped || active} message={active ? "Select another campaign before deleting this one." : busy || deletion.blocksDeletion ? "Finish the current campaign operation first." : "Stop the server before deleting a campaign."}>
                            <button type="button" aria-label={`Delete ${campaign.displayName}`} className={`${fileIconButtonClass} hover:!text-red-300`} disabled={busy || deletion.blocksDeletion || !stopped || active} onClick={() => remove(campaign)}><Trash2 aria-hidden className="size-4" /></button>
                        </DisabledControlHint>}
                    </div>
                </li>;
            })}
        </ul>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {stopHint && <p className="text-xs leading-5 text-foreground-muted">{stopHint}</p>}
            <div className="ml-auto flex flex-wrap gap-2">
                <button type="button" className={fileButtonClass} disabled={busy} onClick={() => setVersion((value) => value + 1)}><RefreshCw aria-hidden className="size-4" />Refresh list</button>
                <DisabledControlHint disabled={newCampaignDisabled} message={newCampaignHint}>
                    <button type="button" className={fileButtonClass} disabled={newCampaignDisabled} onClick={() => setConfirming(true)}><Sparkles aria-hidden className="size-4" />New campaign</button>
                </DisabledControlHint>
            </div>
        </div>
        {message && <p role="status" className="mt-3 text-sm text-foreground-muted">{message}</p>}
        {deletion.message && <p role="status" className="mt-3 text-sm text-foreground-muted">{deletion.message}</p>}
        {deletion.canRecover && canDelete && <button type="button" className={fileButtonClass} onClick={deletion.recover}>Recover deletion request</button>}
        {deletion.statusUnknown && canDelete && <button type="button" className={fileButtonClass} onClick={() => void deletion.checkUnknown()}>Check campaigns to recover</button>}
        {deletion.canRetryUnknown && canDelete && <button type="button" className={fileButtonClass} onClick={deletion.retryUnknown}>Try again</button>}
        <dialog ref={dialogRef} aria-labelledby="new-campaign-heading" onClose={() => setConfirming(false)} className="w-full max-w-md rounded-lg border border-white/10 bg-surface p-5 text-foreground backdrop:bg-black/60">
            <h3 id="new-campaign-heading" className="text-base font-semibold">Start a new campaign?</h3>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">This deletes every campaign on this server and creates a fresh one. Export your save first if you want to keep it. The server stays stopped until you start it.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" className={fileButtonClass} disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
                <button type="button" className={filePrimaryButtonClass} disabled={pending || !stopped} onClick={() => change({ action: "reset-campaign" })}>{pending ? "Starting…" : "Delete saves and start fresh"}</button>
            </div>
        </dialog>
    </div>;
}

function formatBytes(bytes: number) {
    if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1_024))} KB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
