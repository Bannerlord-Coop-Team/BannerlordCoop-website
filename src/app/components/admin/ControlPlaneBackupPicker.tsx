"use client";

import { useEffect, useState } from "react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { backupDescription, restorableBackups } from "@/app/lib/control-plane/backups";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import type { Backup, HostingPage } from "@/app/lib/control-plane/types";

// The parent keys this component by server selection. A late response for a
// previous server is ignored, and its selected backup cannot cross that boundary.
export function ControlPlaneBackupPicker({ serverId, onReady }: {
    serverId: string | null;
    onReady: (ready: boolean) => void;
}) {
    const [loadedAt, setLoadedAt] = useState(0);
    const [page, setPage] = useState<HostingPage<Backup> | null>(null);
    const [cursor, setCursor] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState("");

    useEffect(() => {
        if (!serverId) return;
        let cancelled = false;
        async function load() {
            try {
                const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
                if (!session?.access_token) throw new Error("Authentication is required.");
                const response = await requestControlPlaneAdmin<HostingPage<Backup>>({
                    accessToken: session.access_token,
                    operation: "backups",
                    input: { serverId, cursor, limit: 100 },
                });
                if (!cancelled) { setPage(response); setLoadedAt(Date.now()); setLoading(false); }
            } catch (failure) {
                if (!cancelled) {
                    setError(failure instanceof Error ? failure.message : "Backups could not be loaded.");
                    setLoading(false);
                }
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [serverId, cursor, attempt]);

    function loadPage(nextCursor: string | null) {
        onReady(false);
        setSelectedId("");
        setLoading(true);
        setError(null);
        setPage(null);
        setCursor(nextCursor);
        setAttempt((value) => value + 1);
    }

    if (!serverId) return <p className="text-xs text-foreground-muted">Select a server to load its backups.</p>;
    const backups = restorableBackups(page?.items ?? [], serverId, loadedAt);
    const selected = backups.find((backup) => backup.backupId === selectedId);
    return <div className="space-y-3 text-xs text-foreground-muted">
        <label className="block">Backup
            <select name="backupId" required value={selectedId} disabled={loading || error !== null}
                onChange={(event) => {
                    setSelectedId(event.target.value);
                    onReady(backups.some((backup) => backup.backupId === event.target.value));
                }}
                className="mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground">
                <option value="" disabled>{loading ? "Loading backups…" : "Choose a backup"}</option>
                {backups.map((backup) => <option key={backup.backupId} value={backup.backupId}>{backupDescription(backup)}</option>)}
            </select>
        </label>
        {error && <p role="alert">{error} <button type="button" className="underline" onClick={() => loadPage(cursor)}>Retry</button></p>}
        {!loading && !error && backups.length === 0 && <p>No restorable backups on this page.</p>}
        {selected && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border border-white/10 p-3">
            <dt>Taken</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd>
            <dt>Type</dt><dd>{selected.backupType.replaceAll("-", " ")}</dd>
            <dt>Size</dt><dd>{(selected.byteSize / 1_048_576).toFixed(1)} MiB</dd>
            <dt>Build</dt><dd className="break-all">{selected.buildId ?? "Not recorded"}</dd>
            <dt>Expires</dt><dd>{new Date(selected.retentionExpiresAt).toLocaleString()}</dd>
            <dt>In-game date</dt><dd>Not recorded in backup metadata</dd>
        </dl>}
        <div className="flex gap-4">
            {cursor && <button type="button" disabled={loading} className="underline" onClick={() => loadPage(null)}>Newest backups</button>}
            {page?.nextCursor && <button type="button" disabled={loading} className="underline" onClick={() => loadPage(page.nextCursor)}>Older backups</button>}
        </div>
    </div>;
}
