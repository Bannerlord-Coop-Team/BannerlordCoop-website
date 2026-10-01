"use client";

import { useRouter } from "next/navigation";
import { Terminal } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ServerConsoleWorkspace, coopConsoleCommands } from "./ServerManagementWorkspace";
import { ManagedServerConsole } from "./ManagedServerConsole";
import { DownloadServerLogButton } from "./DownloadServerLogButton";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import { submitManagedConsoleCommand, checkManagedConsoleCommand } from "@/app/servers/managed-server-console-actions";
import { MAXIMUM_CONSOLE_COMMAND_LENGTH, parseConsoleSubmission, type ConsoleSubmission, type ConsoleReference } from "../../../../supabase/functions/_shared/server-console-contract";

const button = "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const commandNames = coopConsoleCommands.map(([usage]) => usage.split(/\s/u, 1)[0]);

/** Completes a command name only through its next namespace separator, never its arguments. */
function completeCommand(draft: string) {
    if (!draft || /\s/u.test(draft)) return "";
    const match = commandNames.find(command => command.startsWith(draft));
    if (!match || match === draft) return "";
    const dot = match.indexOf(".", draft.length);
    return match.slice(draft.length, dot < 0 ? match.length : dot + 1);
}

type Submission = { requestId: string; input: ConsoleSubmission };

/** Runs request-bound game commands on managed servers below the live output in one console card. */
export function ManagedServerCommands({ server, userId, controls }: { server: MyServerSummary; userId: string; controls: ReactNode }) {
    const router = useRouter();
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const inFlight = useRef(false);
    const [draft, setDraft] = useState("");
    const [atEnd, setAtEnd] = useState(false);
    const [focused, setFocused] = useState(false);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [submission, setSubmission] = useState<Submission | null>(null);
    const [job, setJob] = useState<ConsoleReference | null>(null);
    const [busy, setBusy] = useState(false);
    const [polling, setPolling] = useState(false);
    const [error, setError] = useState("");
    const canOperate = server.accessRole === "owner" || server.accessRole === "manager";
    const ready = canOperate && server.operationState === "running" && server.observedGameState === "running";
    const canCompose = ready && !busy && !submission;
    const completion = canCompose && focused && atEnd ? completeCommand(draft) : "";

    useEffect(() => {
        if (!job || !polling) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const deadline = Date.now() + 60_000;
        /** Polls serially, stopping on errors, completion or a bounded observation window. */
        async function poll() {
            try {
                const response = await checkManagedConsoleCommand(job!, userId);
                if (cancelled) return;
                if (!response.ok) {
                    setError(response.message);
                    setPolling(false);
                    return;
                }
                if (response.result.status !== "pending") {
                    router.refresh();
                    setPolling(false);
                    setJob(null);
                    setSubmission(null);
                    setError(response.result.status === "failed" ? `Command failed: ${response.result.errorCode}` : response.result.status === "cancelled" ? "Command cancelled." : "");
                    return;
                }
                if (Date.now() >= deadline) {
                    setPolling(false);
                    setError("Still pending. Check again or watch for the private Discord completion notification. Do not submit a duplicate command.");
                    return;
                }
                timer = setTimeout(poll, 3_000);
            } catch {
                if (cancelled) return;
                setPolling(false);
                setError("Result could not be checked. Check again; do not submit a duplicate command.");
            }
        }
        timer = setTimeout(poll, 3_000);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [job, polling, userId, router]);

    /** Inserts a supported cheat template without sending it to the server. */
    function selectCommand(command: string) {
        setDraft(command);
        inputRef.current?.focus();
    }

    /** Accepts the visible ghost with Tab without sending or interrupting normal focus navigation. */
    function completeWithTab(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || !completion) return;
        event.preventDefault();
        setDraft(draft + completion);
    }

    /** Retains the original payload and UUID whenever delivery cannot be confirmed. */
    async function send(event: FormEvent) {
        event.preventDefault();
        if (inFlight.current || polling || !canOperate) return;
        if (job) {
            setError("");
            setPolling(true);
            return;
        }
        if (!submission && !ready) return;
        let request = submission;
        if (!request) {
            try {
                const input = parseConsoleSubmission({ serverId: server.serverId, command: draft, expectedUpdatedAt: server.updatedAt });
                request = { requestId: crypto.randomUUID(), input };
            } catch {
                setError("Enter one coop.* command (up to 4096 characters), without control characters or command separators.");
                return;
            }
        }
        inFlight.current = true;
        setBusy(true);
        setSubmission(request);
        setError("");
        try {
            const response = await submitManagedConsoleCommand(request.input, request.requestId, userId);
            if (!response.ok) {
                if (response.notSubmitted) setSubmission(null);
                setError(response.message);
                return;
            }
            setJob({ serverId: server.serverId, jobId: response.result.jobId, commandRequestId: request.requestId });
            setPolling(true);
            setDraft("");
        } catch {
            setError("Delivery could not be confirmed. Use Retry send to check the same request; do not submit it as a new command.");
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    return <ServerConsoleWorkspace coopCommandsOnly onSelectCommand={canCompose ? selectCommand : undefined}>
        <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-surface" aria-labelledby={`${id}-heading`}>
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-3 sm:px-4">
                <h2 id={`${id}-heading`} className="mr-auto flex items-center gap-2 text-sm font-semibold"><Terminal className="size-4 text-gold" aria-hidden="true" />Game console</h2>
                <div className="order-last basis-full sm:order-none sm:basis-auto">{controls}</div>
                <DownloadServerLogButton serverId={server.serverId} userId={userId} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-foreground-muted hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40" />
            </div>
            <ManagedServerConsole serverId={server.serverId} commandError={error} />
            <div className="space-y-3 border-t border-white/10 p-3 sm:p-4">
                <form onSubmit={send} className="flex gap-2">
                    <label htmlFor={id} className="sr-only">Game command</label>
                    <div className="relative min-w-0 flex-1">
                        <input
                            ref={inputRef} id={id} value={draft}
                            onChange={event => {
                                const input = event.currentTarget;
                                setDraft(input.value);
                                setAtEnd(input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
                            }}
                            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                            onSelect={event => {
                                const input = event.currentTarget;
                                setAtEnd(input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
                            }}
                            onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)} onKeyDown={completeWithTab}
                            disabled={!canCompose} maxLength={MAXIMUM_CONSOLE_COMMAND_LENGTH} title={ready ? "Enter one coop.* command" : "Commands require owner or manager access and a running, healthy server."}
                            autoComplete="off" aria-autocomplete="inline" aria-describedby={`${id}-shortcuts`} spellCheck={false} placeholder="coop.…"
                            className="min-h-11 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-gold focus:ring-1 focus:ring-gold disabled:opacity-40"
                        />
                        {completion && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2.5 font-mono text-sm whitespace-pre"><div style={{ transform: `translateX(-${scrollLeft}px)` }}><span className="invisible">{draft}</span><span className="text-foreground-muted">{completion}</span></div></div>}
                    </div>
                    <button type="submit" className={button} disabled={busy || polling || !canOperate || (!submission && (!ready || !draft.trim()))}>{busy ? "Sending…" : job ? polling ? "Running…" : "Check result" : submission ? "Retry send" : "Send"}</button>
                </form>
                <p id={`${id}-shortcuts`} className="text-xs text-foreground-muted"><kbd className="font-mono">Enter</kbd> to send</p>
            </div>
        </section>
    </ServerConsoleWorkspace>;
}
