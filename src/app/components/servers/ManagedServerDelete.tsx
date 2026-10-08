"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "@/app/lib/localization/client";
import { deleteManagedServer, type ServerDeletionActionResult } from "@/app/servers/server-deletion-actions";
import { useOptionalManagedServerPolling } from "./ManagedServerPollingProvider";
import type { MyServerDeletionJob, MyServerDeletionStatus } from "@/app/lib/hosting/my-servers";
import type { ServerDeletionIntent } from "../../../../supabase/functions/_shared/server-deletion-contract";

type Props = { serverId: string; displayName: string; expectedUpdatedAt: string; operationState: string };
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const dangerButton = `${button} border-red-400/40 bg-red-400/10 text-red-200 hover:bg-red-400/15`;

const ACTIVE_DELETION_STATES = new Set(["queued", "running", "retry-wait"]);

export function ManagedServerDelete(props: Props & { accessRole: string; deletionStatus?: MyServerDeletionStatus | null }) {
    const router = useRouter();
    const polling = useOptionalManagedServerPolling();
    const deletionJob = props.deletionStatus?.job ?? null;
    const activeJobId = deletionJob !== null && ACTIVE_DELETION_STATES.has(deletionJob.state) ? deletionJob.jobId : null;
    const pollingRef = useRef(polling);
    const startedDeletionJobId = useRef<string | null>(null);
    useEffect(() => { pollingRef.current = polling; }, [polling]);
    useEffect(() => {
        if (activeJobId === null) {
            if (startedDeletionJobId.current !== null) pollingRef.current?.endPolling(props.serverId);
            startedDeletionJobId.current = null;
            return;
        }
        const channel = pollingRef.current;
        if (channel === null || startedDeletionJobId.current === activeJobId) return;
        startedDeletionJobId.current = activeJobId;
        channel.beginPolling(props.serverId, props.expectedUpdatedAt, activeJobId, "server");
    }, [activeJobId, props.expectedUpdatedAt, props.serverId]);
    useEffect(() => () => {
        if (startedDeletionJobId.current !== null) pollingRef.current?.endPolling(props.serverId);
    }, [props.serverId]);
    if (props.accessRole !== "owner") return null;
    return <ServerDeletionPanel {...props} onDelete={async intent => {
        const outcome = await deleteManagedServer(intent);
        if (outcome.ok) {
            if (outcome.jobId !== undefined && polling !== null) {
                polling.beginPolling(props.serverId, props.expectedUpdatedAt, outcome.jobId, "server");
            }
            router.refresh();
        } else if (outcome.rejected) {
            router.refresh();
        }
        return outcome;
    }} deletionJob={deletionJob} />;
}

/** The public mock uses this same confirmation UI with a local-only submit callback. */
export function ServerDeletionPanel({ onDelete, deletionJob = null, ...props }: Props & { deletionJob?: MyServerDeletionJob | null; onDelete: (intent: ServerDeletionIntent) => Promise<ServerDeletionActionResult> }) {
    const { t } = useTranslations("managed-server");
    const trigger = useRef<HTMLButtonElement>(null);
    const [attempt, setAttempt] = useState<ServerDeletionIntent | null>(null);
    const inFlight = useRef(false);
    const [target, setTarget] = useState<Props | null>(null);
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<ServerDeletionActionResult | null>(null);
    const unavailable = ["suspended", "deletion-pending", "deleting", "deleted"].includes(props.operationState);
    const changed = target !== null && (target.serverId !== props.serverId || target.displayName !== props.displayName || target.expectedUpdatedAt !== props.expectedUpdatedAt);

    async function submit(confirmationText: string) {
        if (!target || inFlight.current || result?.ok || (changed && !attempt) || unavailable && !attempt) return;
        const intent = attempt ?? { serverId: target.serverId, expectedUpdatedAt: target.expectedUpdatedAt, confirmationText, requestId: crypto.randomUUID() };
        setAttempt(intent);
        inFlight.current = true; setPending(true);
        try {
            const outcome = await onDelete(intent).catch<ServerDeletionActionResult>(() => ({ ok: false, message: t("deletion.unknown") }));
            setResult(outcome);
            // Accepted jobs are tracked by the page-level status row. Close the
            // confirmation modal so the live deletion progress is immediately
            // visible instead of being trapped behind its backdrop. A
            // definitive rejection also needs the same treatment: the owner
            // must refresh/reconfirm rather than staring at a disabled form.
            if (outcome.ok || outcome.rejected) {
                setTarget(null);
                setAttempt(null);
            }
        } finally { inFlight.current = false; setPending(false); }
    }
    function dismiss() {
        if (inFlight.current) return;
        setTarget(null);
        // Keep uncertain submissions for an explicit retry with the same idempotency key.
        if (result?.rejected) { setAttempt(null); setResult(null); }
    }
    return <section className="rounded-lg border border-red-400/25 bg-red-400/[0.03] p-5 sm:p-6" aria-labelledby="server-deletion-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 id="server-deletion-heading" className="flex items-center gap-2 text-base font-semibold text-red-200"><TriangleAlert aria-hidden="true" className="size-5" />{t("deletion.title")}</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-foreground-muted">{t("deletion.description")}</p></div>
            <button ref={trigger} type="button" disabled={(unavailable && !attempt) || result?.ok === true || (deletionJob !== null && ACTIVE_DELETION_STATES.has(deletionJob.state))} className={`${dangerButton} shrink-0`}
                onClick={() => { if (!attempt) setResult(null); setTarget(attempt ? { ...props, displayName: attempt.confirmationText, expectedUpdatedAt: attempt.expectedUpdatedAt } : props); }}>
                <Trash2 aria-hidden="true" className="size-4" />{t("deletion.open")}</button>
        </div>
        {deletionJob && <DeletionProgress job={deletionJob} />}
        {result && <p role={result.ok ? "status" : "alert"} aria-live={result.ok ? "polite" : "assertive"} className="mt-3 text-sm leading-6 text-foreground-muted">{result.message}</p>}
        {unavailable && !result?.ok && <p className="mt-3 text-sm text-foreground-muted">{t("deletion.unavailable")}</p>}
        {target && <DeletionDialog name={target.displayName} pending={pending} result={result} changed={changed}
            retry={attempt !== null && !result?.ok && !result?.rejected} onSubmit={submit} onDismiss={dismiss} trigger={trigger} />}
    </section>;
}

function DeletionProgress({ job }: { job: MyServerDeletionJob }) {
    const { t } = useTranslations("managed-server");
    const message = job.state === "succeeded"
        ? t("deletion.completed")
        : job.state === "failed" || job.state === "cancelled"
            ? t("deletion.failed", { progress: job.progress })
            : t("deletion.progress", { progress: job.progress });
    return <p role="status" aria-live="polite" className="mt-4 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm leading-6 text-foreground-muted">{message}</p>;
}

function DeletionDialog({ name, pending, result, changed, retry, onSubmit, onDismiss, trigger }: {
    name: string; pending: boolean; result: ServerDeletionActionResult | null; changed: boolean; retry: boolean;
    onSubmit: (name: string) => void; onDismiss: () => void; trigger: React.RefObject<HTMLButtonElement | null>;
}) {
    const { t } = useTranslations("managed-server");
    const dialog = useRef<HTMLDialogElement>(null);
    const cancel = useRef<HTMLButtonElement>(null);
    const [typedName, setTypedName] = useState("");
    const [acknowledged, setAcknowledged] = useState(false);
    useEffect(() => {
        const element = dialog.current!;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        element.showModal(); cancel.current?.focus();
        return () => { element.close(); document.body.style.overflow = previousOverflow; trigger.current?.focus(); };
    }, [trigger]);
    const disabled = pending || result?.ok === true || result?.rejected === true || (!retry && changed);
    function submit(event: FormEvent) { event.preventDefault(); if (!disabled && typedName === name && acknowledged) onSubmit(typedName); }
    return <dialog ref={dialog} aria-labelledby="delete-server-title" aria-describedby="delete-server-warning"
        onCancel={event => { event.preventDefault(); onDismiss(); }}
        onKeyDown={event => {
            if (event.key !== "Tab") return;
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]")];
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-lg border border-red-400/35 bg-surface-raised p-0 text-foreground shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm">
        <div className="border-t-2 border-red-400 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-3"><h2 id="delete-server-title" className="font-display text-2xl font-semibold">{t("deletion.dialogTitle")}</h2>
                <button type="button" disabled={pending} aria-label={t("deletion.cancel")} className={`${button} shrink-0 border-white/15 px-2`} onClick={onDismiss}><X aria-hidden="true" className="size-5" /></button></div>
            <p className="mt-3 break-words text-lg font-medium text-red-200">{name}</p>
            <p id="delete-server-warning" className="mt-3 text-sm leading-6 text-foreground-muted">{t("deletion.warning")}</p>
            <p className="mt-3 rounded-md border border-white/10 bg-background p-3 text-sm leading-6 text-foreground-muted">{t("deletion.backup")}</p>
            <form onSubmit={submit} className="mt-5">
                <fieldset disabled={disabled}>
                    <label htmlFor="delete-server-name" className="text-sm font-medium">{t("deletion.typeName")}</label>
                    <input id="delete-server-name" value={typedName} onChange={event => setTypedName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} autoComplete="off" spellCheck={false} maxLength={48}
                        aria-describedby="delete-server-name-hint" className="mt-2 block min-h-12 w-full rounded-md border border-white/20 bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-gold" />
                    <p id="delete-server-name-hint" className="mt-2 text-xs text-foreground-muted">{t("deletion.exactName")}</p>
                    <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 size-4 shrink-0 accent-red-400" />{t("deletion.acknowledge")}</label>
                </fieldset>
                {changed && !retry && !result && <p role="alert" className="mt-4 text-sm text-red-200">{t("deletion.rejected")}</p>}
                {result && <p role={result.ok ? "status" : "alert"} className="mt-4 text-sm leading-6 text-foreground-muted">{result.message}</p>}
                <div className="mt-6 flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:justify-end">
                    <button ref={cancel} type="button" disabled={pending} onClick={onDismiss} className={`${button} border-white/15`}>{t(result?.ok ? "deletion.done" : "deletion.cancel")}</button>
                    {!result?.ok && <button type="submit" disabled={disabled || typedName !== name || !acknowledged} className={dangerButton}>{t(pending ? "deletion.submitting" : retry ? "deletion.retry" : "deletion.confirm")}</button>}
                </div>
            </form>
        </div>
    </dialog>;
}
