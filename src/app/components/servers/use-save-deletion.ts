"use client";

import { useEffect, useRef, useState } from "react";
import { deleteManagedServerSave, readManagedServerSaveDeletion } from "@/app/servers/managed-server-save-actions";
import { parseSaveDeletionInput, type SaveDeletionInput } from "../../../../supabase/functions/_shared/server-save-deletion-contract";
import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { requireUuid } from "../../../../supabase/functions/_shared/server-file-contract";

type Retained = { input: SaveDeletionInput; jobId: string | null };
function read(key: string, serverId: string): Retained | null {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    if (raw.length > 2_048) throw new Error("Invalid retained deletion");
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !hasExactKeys(value, ["input", "jobId"])) throw new Error("Invalid retained deletion");
    const input = parseSaveDeletionInput(value.input);
    if (input.serverId !== serverId) throw new Error("Invalid retained server");
    if (value.jobId !== null) requireUuid(value.jobId);
    return { input, jobId: value.jobId as string | null };
}

export function useSaveDeletion(userId: string, serverId: string, onCompleted: () => void) {
    const key = `campaign-deletion:v1:${encodeURIComponent(userId)}:${serverId}`;
    const [retained, setRetained] = useState<Retained | null>(null);
    const [message, setMessage] = useState("");
    const [settled, setSettled] = useState(false);
    const [sending, setSending] = useState(false);
    const [loadedKey, setLoadedKey] = useState("");
    const generation = useRef(0);
    const completed = useRef(onCompleted);
    completed.current = onCompleted;

    useEffect(() => {
        generation.current++;
        setSettled(false); setRetained(null); setSending(false); setMessage(""); setLoadedKey("");
        try {
            const saved = read(key, serverId);
            setRetained(saved); setLoadedKey(key);
            if (saved) setMessage(saved.jobId ? "Checking campaign deletion status…" : "The deletion reply was not received. Recover the original request to check whether it was accepted.");
        } catch {
            setMessage("The saved deletion request could not be read. Campaign deletion is unavailable in this browser.");
        }
        return () => { generation.current++; };
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
                setSettled(false);
                setMessage(result && !result.ok ? result.message : "Campaign deletion status is unavailable. Refresh later to check the original request.");
                failures++;
            } else {
                failures = 0;
                setMessage(result.message);
                if (["succeeded", "failed", "cancelled"].includes(result.status.state)) {
                    setSettled(true);
                    completed.current();
                    return;
                }
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
            if (read(key, serverId)?.input.requestId !== saved.input.requestId) throw new Error("Deletion request changed");
            if (result.ok) {
                requireUuid(result.jobId);
                const accepted = { ...saved, jobId: result.jobId };
                localStorage.setItem(key, JSON.stringify(accepted));
                setRetained(accepted); setMessage(result.message);
            } else {
                setMessage(result.message);
                if (result.notSubmitted) { localStorage.removeItem(key); setRetained(null); }
            }
        } catch {
            if (generation.current === currentGeneration) setMessage("The deletion reply was not received. Recover the original request; it will not create another deletion.");
        } finally {
            if (generation.current === currentGeneration) setSending(false);
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
        begin, message, busy: loadedKey !== key || sending || (retained !== null && !settled),
        canRecover: loadedKey === key && retained !== null && retained.jobId === null && !sending,
        recover: () => { if (retained && !retained.jobId && !sending) void submit(retained); },
    };
}
