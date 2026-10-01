"use client";

import { Terminal } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ServerConsoleWorkspace, coopConsoleCommands } from "./ServerManagementWorkspace";
import { ManagedServerConsole } from "./ManagedServerConsole";
import { DownloadServerLogButton } from "./DownloadServerLogButton";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import { submitManagedConsoleCommand } from "@/app/servers/managed-server-console-actions";
import { MAXIMUM_CONSOLE_COMMAND_LENGTH, parseConsoleSubmission, type ConsoleSubmission } from "../../../../supabase/functions/_shared/server-console-contract";

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

/** Keeps command entry available while submissions run; results arrive through live stdout. */
export function ManagedServerCommands({ server, userId, controls }: { server: MyServerSummary; userId: string; controls: ReactNode }) {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState("");
    const [atEnd, setAtEnd] = useState(false);
    const [focused, setFocused] = useState(false);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [error, setError] = useState("");
    const canOperate = server.accessRole === "owner" || server.accessRole === "manager";
    const ready = canOperate && server.operationState === "running" && server.observedGameState === "running";
    const completion = ready && focused && atEnd ? completeCommand(draft) : "";

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

    /** Clears the composer before dispatch and reports failures without blocking subsequent commands. */
    async function send(event: FormEvent) {
        event.preventDefault();
        if (!ready || !draft.trim()) return;
        let input: ConsoleSubmission;
        try {
            input = parseConsoleSubmission({ serverId: server.serverId, command: draft, expectedUpdatedAt: server.updatedAt });
        } catch {
            setError("Enter one coop.* command (up to 4096 characters), without control characters or command separators.");
            return;
        }
        setDraft("");
        setError("");
        inputRef.current?.focus();
        try {
            const response = await submitManagedConsoleCommand(input, crypto.randomUUID(), userId);
            if (!response.ok) setError(`${input.command}: ${response.message}`);
        } catch {
            setError(`${input.command}: Delivery could not be confirmed. Check console output or Discord before resending.`);
        }
    }

    return <ServerConsoleWorkspace coopCommandsOnly onSelectCommand={ready ? selectCommand : undefined}>
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
                            disabled={!ready} maxLength={MAXIMUM_CONSOLE_COMMAND_LENGTH} title={ready ? "Enter one coop.* command" : "Commands require owner or manager access and a running, healthy server."}
                            autoComplete="off" aria-autocomplete="inline" aria-describedby={`${id}-shortcuts`} spellCheck={false} placeholder="coop.…"
                            className="min-h-11 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-gold focus:ring-1 focus:ring-gold disabled:opacity-40"
                        />
                        {completion && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2.5 font-mono text-sm whitespace-pre"><div style={{ transform: `translateX(-${scrollLeft}px)` }}><span className="invisible">{draft}</span><span className="text-foreground-muted">{completion}</span></div></div>}
                    </div>
                    <button type="submit" className={button} disabled={!ready || !draft.trim()}>Send</button>
                </form>
                <p id={`${id}-shortcuts`} className="text-xs text-foreground-muted"><kbd className="font-mono">Enter</kbd> to send</p>
            </div>
        </section>
    </ServerConsoleWorkspace>;
}
