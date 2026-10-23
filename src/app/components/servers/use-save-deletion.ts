"use client";

import { useEffect, useRef, useState } from "react";
import { deleteManagedServerSave, readManagedServerSaveDeletion } from "@/app/servers/managed-server-save-actions";
import { listManagedServerCampaigns } from "@/app/servers/managed-server-campaign-actions";
import { parseSaveDeletionInput, type SaveDeletionInput } from "../../../../supabase/functions/_shared/server-save-deletion-contract";
import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { requireUuid } from "../../../../supabase/functions/_shared/server-file-contract";

type Receipt = { input: SaveDeletionInput; jobId: string | null; terminal?: boolean };
type Retained = Receipt & { previous?: Receipt };
function read(key: string, serverId: string): Retained | null {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    if (raw.length > 4_096) throw new Error("Invalid retained deletion");
    return parseReceipt(JSON.parse(raw), serverId);
}
function parseReceipt(value: unknown, serverId: string, allowPrevious = true): Retained {
    if (!isRecord(value) || !hasExactKeys(value, ["input", "jobId", ...("terminal" in value ? ["terminal"] : []), ...(allowPrevious && "previous" in value ? ["previous"] : [])])
        || ("terminal" in value && typeof value.terminal !== "boolean")) throw new Error("Invalid retained deletion");
    const input = parseSaveDeletionInput(value.input);
    if (input.serverId !== serverId) throw new Error("Invalid retained server");
    if (value.jobId !== null) requireUuid(value.jobId);
    const previous = "previous" in value ? parseReceipt(value.previous, serverId, false) : undefined;
    if (previous && (!previous.jobId || previous.input.saveId !== input.saveId)) throw new Error("Invalid previous deletion");
    return { input, jobId: value.jobId as string | null, terminal: value.terminal === true && value.jobId !== null, ...(previous ? { previous } : {}) };
}

export function useSaveDeletion(userId: string, serverId: string, onCompleted: () => void) {
    const key = `campaign-deletion:v1:${encodeURIComponent(userId)}:${serverId}`;
    const [retained, setRetained] = useState<Retained | null>(null);
    const [message, setMessage] = useState("");
    const [settled, setSettled] = useState(false);
    const [sending, setSending] = useState(false);
    const [active, setActive] = useState(false);
    const [unknown, setUnknown] = useState(false);
    const [retryCandidate, setRetryCandidate] = useState<Omit<SaveDeletionInput, "requestId"> | null>(null);
    const [loadedKey, setLoadedKey] = useState("");
    const generation = useRef(0);
    const completed = useRef(onCompleted);
    useEffect(() => { completed.current = onCompleted; }, [onCompleted]);

    useEffect(() => {
        const currentGeneration = ++generation.current;
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setSettled(false); setRetained(null); setSending(false); setActive(false); setUnknown(false); setRetryCandidate(null); setMessage(""); setLoadedKey("");
            try {
                const saved = read(key, serverId);
                setRetained(saved); setLoadedKey(key); setSettled(saved?.terminal === true);
                if (saved) {
                    setUnknown(saved.jobId === null);
                    setMessage(saved.jobId ? "Checking campaign deletion status…" : "Status unknown. Recover the original request to check whether it was accepted.");
                }
            } catch {
                setUnknown(true);
                setMessage("Status unknown. The saved deletion request could not be read. Check campaigns to recover.");
            }
        });
        return () => { cancelled = true; generation.current = currentGeneration + 1; };
    }, [key, serverId]);

    useEffect(() => {
        if (loadedKey !== key || !retained?.jobId) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        let failures = 0;
        async function poll() {
            if (document.visibilityState === "hidden") { timer = setTimeout(poll, 5_000); return; }
            let result: Awaited<ReturnType<typeof readManagedServerSaveDeletion>> | null = null;
            try { result = await readManagedServerSaveDeletion(serverId, retained!.jobId!, userId); } catch { /* retain the receipt */ }
            if (cancelled) return;
            if (!result?.ok || result.status.saveId !== retained!.input.saveId) {
                setSettled(retained!.terminal === true); setActive(false); setUnknown(true);
                setMessage(result && !result.ok ? result.message : "Campaign deletion status is unavailable. Refresh later to check the original request.");
                failures++;
            } else {
                failures = 0;
                setUnknown(false); setRetryCandidate(null);
                setMessage(result.message);
                if (["succeeded", "failed", "cancelled"].includes(result.status.state)) {
                    setSettled(true); setActive(false);
                    try {
                        if (read(key, serverId)?.input.requestId === retained!.input.requestId) {
                            localStorage.setItem(key, JSON.stringify({ ...retained, terminal: true }));
                        }
                    } catch { /* a later authorized read can recover the terminal receipt */ }
                    completed.current();
                    return;
                }
                setActive(true);
            }
            timer = setTimeout(poll, Math.min(60_000, 5_000 * 2 ** Math.min(failures, 4)));
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [retained, key, loadedKey, serverId, userId]);

    async function submit(saved: Retained) {
        const currentGeneration = generation.current;
        setSending(true);
        try {
            const result = await deleteManagedServerSave(saved.input, userId);
            if (generation.current !== currentGeneration) return;
            const current = read(key, serverId);
            if (current && current.input.requestId !== saved.input.requestId) {
                setRetained(current); setSettled(current.terminal === true);
                setMessage("Another deletion request is now saved in this browser. Checking that request.");
                return;
            }
            if (result.ok) {
                requireUuid(result.jobId);
                const accepted = { input: saved.input, jobId: result.jobId };
                localStorage.setItem(key, JSON.stringify(accepted));
                setRetained(accepted); setMessage(result.message); setUnknown(false);
            } else {
                setMessage(result.message);
                setUnknown(!result.notSubmitted);
                if (result.notSubmitted) {
                    if (saved.previous) {
                        localStorage.setItem(key, JSON.stringify(saved.previous));
                        setRetained(saved.previous); setSettled(saved.previous.terminal === true); setUnknown(true);
                        setMessage("The retry was refused. Checking the original deletion request.");
                    } else { localStorage.removeItem(key); setRetained(null); }
                }
            }
        } catch {
            if (generation.current === currentGeneration) {
                setUnknown(true);
                setMessage("Status unknown. The deletion reply was not received. Recover the original request; it will not create another deletion.");
            }
        } finally {
            if (generation.current === currentGeneration) setSending(false);
        }
    }

    async function checkUnknown() {
        if (sending || !window.confirm("Check the current campaign list to resolve this unknown deletion? Nothing will be deleted automatically.")) return;
        const currentGeneration = generation.current;
        setSending(true);
        try {
            const before = localStorage.getItem(key);
            let snapshot: Retained | null = null;
            try { snapshot = read(key, serverId); } catch { /* corrupt data has no trusted target */ }
            if (snapshot && (snapshot.input.requestId !== retained?.input.requestId || snapshot.jobId !== retained?.jobId)) {
                setRetained(snapshot); setLoadedKey(key); setSettled(snapshot.terminal === true);
                setUnknown(snapshot.jobId === null); setRetryCandidate(null); setActive(false);
                setMessage("Another deletion request is now saved in this browser. Checking that request.");
                return;
            }
            const result = await listManagedServerCampaigns(serverId, userId);
            if (generation.current !== currentGeneration) return;
            if (!result.ok || result.campaigns.serverId !== serverId) throw new Error("Campaign list unavailable");
            if (localStorage.getItem(key) !== before) throw new Error("Saved request changed");
            const campaign = snapshot && result.campaigns.items.find(item => item.saveId === snapshot.input.saveId);
            if (snapshot && campaign) {
                setRetryCandidate({ serverId, saveId: campaign.saveId, expectedUpdatedAt: result.campaigns.updatedAt, confirmationText: campaign.displayName });
                setMessage("Status unknown. This campaign is still present. You can try again; the server will refuse a duplicate active deletion.");
            } else {
                // Explicit recovery after a fresh authorized list; never infer a target from corrupt bytes.
                localStorage.removeItem(key); setRetained(null); setSettled(false); setLoadedKey(key); setUnknown(false);
                setMessage(snapshot ? "Campaign deleted. It is no longer in the current campaign list."
                    : "The unreadable request was cleared after checking the campaign list. Choose a campaign below if you want to try again.");
                completed.current();
            }
        } catch {
            if (generation.current === currentGeneration) setMessage("Status unknown. The current campaigns could not be checked. Try again later.");
        } finally {
            if (generation.current === currentGeneration) setSending(false);
        }
    }

    function retryUnknown() {
        if (!retryCandidate || sending) return;
        if (!window.confirm(`Try deleting "${retryCandidate.confirmationText}" again with a new request?`)) return;
        if (window.prompt("Type the exact campaign name to confirm.") !== retryCandidate.confirmationText) return;
        try {
            const current = read(key, serverId);
            if (current?.input.requestId !== retained?.input.requestId) throw new Error("Saved request changed");
            // Keep the accepted receipt through ambiguous retries and refreshes, without growing a chain.
            const previous = current?.previous ?? (current?.jobId ? current : undefined);
            const saved = { input: { ...retryCandidate, requestId: crypto.randomUUID() }, jobId: null, ...(previous ? { previous } : {}) };
            localStorage.setItem(key, JSON.stringify(saved));
            setRetained(saved); setSettled(false); setUnknown(false); setRetryCandidate(null);
            void submit(saved);
        } catch {
            setMessage("The saved request changed or could not be stored. Check campaigns again.");
        }
    }

    function begin(input: SaveDeletionInput) {
        if (loadedKey !== key || sending || (retained && !settled)) return;
        try {
            const existing = read(key, serverId);
            if (existing && (!settled || existing.input.requestId !== retained?.input.requestId)) {
                setRetained(existing); setSettled(false);
                setMessage("An earlier deletion request must be checked first.");
                return;
            }
            const saved = { input: parseSaveDeletionInput(input), jobId: null };
            // Persist before the first write so a reload or lost response keeps the same request UUID.
            localStorage.setItem(key, JSON.stringify(saved));
            setRetained(saved); setSettled(false);
            void submit(saved);
        } catch {
            setMessage("The deletion request could not be saved in this browser, so it was not sent.");
        }
    }
    return {
        begin, message, busy: sending || active,
        statusUnknown: unknown && !sending, checkUnknown, retryUnknown, canRetryUnknown: retryCandidate !== null && !sending,
        blocksDeletion: loadedKey !== key || sending || (retained !== null && !settled),
        canRecover: loadedKey === key && retained !== null && retained.jobId === null && !sending,
        recover: () => { if (retained && !retained.jobId && !sending) void submit(retained); },
    };
}
