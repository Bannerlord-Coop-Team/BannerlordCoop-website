"use client";

import { LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ControlPlaneAdminError, requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import {
    CHANGE_SERVER_REGION_OPERATION,
    type ChangeServerRegionInput,
    type RegionChangeTarget,
} from "@/app/lib/control-plane/region-change";
import type { RelocationRow } from "@/app/lib/control-plane/relocation";
import { vpsProviderLabel } from "@/app/lib/control-plane/vps-providers";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";

const fieldClass = "mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold";
const buttonClass = "inline-flex min-h-9 items-center gap-1.5 border px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-40";

export function ChangeRegionDialog({ row, targets, onClose, onQueued }: {
    row: RelocationRow;
    targets: readonly RegionChangeTarget[];
    onClose: () => void;
    onQueued: (serverId: string) => void;
}) {
    const router = useRouter();
    const dialog = useRef<HTMLDialogElement>(null);
    const previousRequest = useRef<{ input: string; requestId: string } | null>(null);
    const [region, setRegion] = useState("");
    const [provider, setProvider] = useState("");
    const [host, setHost] = useState("");
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const [stale, setStale] = useState(false);
    const regions = new Map(targets.map(target => [target.region, target.label]));
    const providers = targets.filter(target => target.region === region);
    const destination = providers.find(target => target.provider === provider);
    const canSubmit = destination !== undefined && reason.trim().length >= 3
        && (host === "" || destination.hosts.some(candidate => candidate.name === host));

    useEffect(() => {
        const element = dialog.current;
        if (element && !element.open) element.showModal();
    }, []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!canSubmit || destination === undefined || pending || stale) return;
        const input: ChangeServerRegionInput = {
            serverId: row.server.serverId,
            expectedUpdatedAt: row.server.updatedAt,
            targetRegion: destination.region,
            targetProvider: destination.provider,
            targetServiceName: host === "" ? null : host,
            reason: reason.trim(),
        };
        const identity = JSON.stringify(input);
        const request = previousRequest.current?.input === identity
            ? previousRequest.current : { input: identity, requestId: crypto.randomUUID() };
        previousRequest.current = request;
        setPending(true);
        setError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            await requestControlPlaneAdmin({
                accessToken: session.access_token, requestId: request.requestId, operation: CHANGE_SERVER_REGION_OPERATION, input,
            });
            onQueued(row.server.serverId);
            router.refresh();
        } catch (cause) {
            if (cause instanceof ControlPlaneAdminError && cause.code === "stale_interaction") {
                setStale(true);
                setError("The server changed. Close this form and review the current region and assignment before trying again.");
                router.refresh();
            } else {
                setError(cause instanceof Error ? cause.message : "The region change could not be queued.");
            }
        } finally {
            setPending(false);
        }
    }

    return (
        <dialog
            ref={dialog}
            aria-labelledby="change-region-title"
            onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}
            className="fixed inset-0 m-auto max-h-[90svh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border border-gold/30 bg-surface-raised p-5 text-foreground shadow-2xl backdrop:bg-black/70 sm:p-6"
        >
            <div className="flex items-start justify-between gap-4">
                <h2 id="change-region-title" className="font-display text-3xl font-semibold">Change server region</h2>
                <button type="button" aria-label="Close" disabled={pending} onClick={onClose} className="p-1 text-foreground-muted focus-visible:outline-gold"><X aria-hidden="true" className="size-5" /></button>
            </div>
            <p className="mt-4 text-sm text-foreground-muted">
                {row.server.displayName} is in {row.regionLabel} on {vpsProviderLabel(row.server.provider)}.
            </p>
            {regions.size === 0 ? <p className="mt-5 text-sm text-foreground-muted">No other published region has a free VPS slot.</p> : (
                <form onSubmit={submit} className="mt-5 space-y-4">
                    <label className="block text-xs text-foreground-muted">Destination region
                        <select required value={region} disabled={pending || stale} onChange={event => {
                            setRegion(event.target.value); setProvider(""); setHost("");
                        }} className={fieldClass}>
                            <option value="" disabled>Choose a region</option>
                            {[...regions].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                    </label>
                    <label className="block text-xs text-foreground-muted">Destination provider
                        <select required value={provider} disabled={pending || stale || region === ""} onChange={event => {
                            setProvider(event.target.value); setHost("");
                        }} className={fieldClass}>
                            <option value="" disabled>Choose a provider</option>
                            {providers.map(target => <option key={target.provider} value={target.provider}>{vpsProviderLabel(target.provider)}</option>)}
                        </select>
                    </label>
                    <label className="block text-xs text-foreground-muted">Destination VPS
                        <select value={host} disabled={pending || stale || destination === undefined} onChange={event => setHost(event.target.value)} className={fieldClass}>
                            <option value="">Any eligible VPS on this provider</option>
                            {destination?.hosts.map(target => <option key={target.name} value={target.name}>{target.name} · {target.freeSlots} free</option>)}
                        </select>
                    </label>
                    <label className="block text-xs text-foreground-muted">Reason
                        <textarea required minLength={3} maxLength={1000} rows={2} value={reason} disabled={pending || stale}
                            onChange={event => setReason(event.target.value)} className={fieldClass} />
                    </label>
                    <p className="text-sm text-amber-200">A running server gets one hour’s notice, then saves and stops for the move. Players will need the new join address and port.</p>
                    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
                    <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
                        <button type="button" disabled={pending} onClick={onClose} className={`${buttonClass} border-white/15 text-foreground-muted hover:text-foreground`}>Cancel</button>
                        <button type="submit" disabled={pending || stale || !canSubmit} className={`${buttonClass} border-crimson bg-crimson text-white`}>
                            {pending && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
                            {pending ? "Queueing" : "Confirm region change"}
                        </button>
                    </div>
                </form>
            )}
        </dialog>
    );
}
