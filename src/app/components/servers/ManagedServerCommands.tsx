"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { LoaderCircle, Terminal } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ServerConsoleWorkspace, coopConsoleCommands } from "./ServerManagementWorkspace";
import { ManagedServerConsole } from "./ManagedServerConsole";
import { DownloadServerLogButton } from "./DownloadServerLogButton";
import { ManagedServerStatusSlotContext } from "./ManagedServerPollingProvider";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import { submitManagedConsoleCommand } from "@/app/servers/managed-server-console-actions";
import { MAXIMUM_CONSOLE_COMMAND_LENGTH, parseConsoleSubmission, type ConsoleSubmission } from "../../../../supabase/functions/_shared/server-console-contract";

const button = "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const commandNames = coopConsoleCommands.map(([usage]) => usage.split(/\s/u, 1)[0]);
/** An unconfirmed delivery stops being useful once output would have appeared. */
const UNCERTAIN_NOTICE_MILLISECONDS = 20_000;
const SENT_NOTICE_MILLISECONDS = 5_000;

type ComposerFeedback = { kind: "invalid" | "error" | "sent"; text: ReactNode };

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
    const { t, rich } = useTranslations("managed-server");
    const shared = useTranslations("server-common");
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const sentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [draft, setDraft] = useState("");
    const [atEnd, setAtEnd] = useState(false);
    const [focused, setFocused] = useState(false);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [feedback, setFeedback] = useState<ComposerFeedback | null>(null);
    const [sending, setSending] = useState(0);
    const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);
    const canOperate = server.accessRole === "owner" || server.accessRole === "manager";
    const ready = canOperate && server.operationState === "running" && server.observedGameState === "running";
    const completion = ready && focused && atEnd ? completeCommand(draft) : "";

    useEffect(() => () => clearTimeout(sentTimer.current), []);

    /** Inserts a supported cheat template without sending it to the server. */
    function selectCommand(command: string) {
        setDraft(command);
        setFeedback(current => current?.kind === "invalid" ? null : current);
        inputRef.current?.focus();
    }

    /** Accepts the visible ghost with Tab without sending or interrupting normal focus navigation. */
    function completeWithTab(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || !completion) return;
        event.preventDefault();
        setDraft(draft + completion);
    }

    /** Shows composer feedback under the input; transient notices clear themselves once they are no longer useful. */
    function showFeedback(next: ComposerFeedback, clearAfter = next.kind === "sent" ? SENT_NOTICE_MILLISECONDS : undefined) {
        clearTimeout(sentTimer.current);
        setFeedback(next);
        if (clearAfter !== undefined) {
            sentTimer.current = setTimeout(() => setFeedback(current => current === next ? null : current), clearAfter);
        }
    }

    /** Explains why a draft cannot be sent, pointing non-coop commands to the command browser. */
    function invalidDraftMessage(command: string): ReactNode {
        return command.normalize("NFKC").trim().startsWith("coop.")
            ? t("commands.enterOneCoopCommandUpTo4096CharactersWithoutControl")
            : rich("commands.theWebConsoleRunsCoopCommandsOnlyUseBrowseBelow", { browse: <strong className="font-semibold">{shared.t("managementWorkspace.browseCommands")}</strong> });
    }

    /** Clears the composer before dispatch and reports failures without blocking subsequent commands. */
    async function send(event: FormEvent) {
        event.preventDefault();
        if (!ready || !draft.trim()) return;
        let input: ConsoleSubmission;
        try {
            input = parseConsoleSubmission({ serverId: server.serverId, command: draft, expectedUpdatedAt: server.updatedAt });
        } catch {
            showFeedback({ kind: "invalid", text: invalidDraftMessage(draft) });
            inputRef.current?.focus();
            return;
        }
        setDraft("");
        clearTimeout(sentTimer.current);
        setFeedback(null);
        setSending(count => count + 1);
        inputRef.current?.focus();
        try {
            const response = await submitManagedConsoleCommand(input, crypto.randomUUID(), userId);
            if (response.ok) {
                showFeedback({ kind: "sent", text: t("commands.sentCommandOutputAppearsAbove", { command: input.command }) });
            } else if (response.uncertain) {
                showFeedback({ kind: "error", text: t("commands.weCouldnTConfirmCommandWasDeliveredIfNoOutput", { command: input.command }) }, UNCERTAIN_NOTICE_MILLISECONDS);
            } else {
                showFeedback({ kind: "error", text: `${input.command}: ${response.message}` });
                setDraft(current => current || input.command);
            }
        } catch {
            showFeedback({ kind: "error", text: t("commands.weCouldnTConfirmCommandWasDeliveredIfNoOutput", { command: input.command }) }, UNCERTAIN_NOTICE_MILLISECONDS);
        } finally {
            setSending(count => count - 1);
        }
    }

    const describedBy = feedback ? `${id}-shortcuts ${id}-feedback` : `${id}-shortcuts`;
    return <ServerConsoleWorkspace coopCommandsOnly onSelectCommand={ready ? selectCommand : undefined}>
        <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-surface" aria-labelledby={`${id}-heading`}>
            <ManagedServerStatusSlotContext.Provider value={statusSlot}>
                <div className="border-b border-white/10">
                    <div className="flex flex-wrap items-center gap-3 p-3 sm:px-4">
                        <h2 id={`${id}-heading`} className="mr-auto flex items-center gap-2 text-sm font-semibold"><Terminal className="size-4 text-gold" aria-hidden="true" />{t("commands.gameConsole")}</h2>
                        <div className="order-last basis-full sm:order-none sm:basis-auto">{controls}</div>
                        <DownloadServerLogButton serverId={server.serverId} userId={userId} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-foreground-muted hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40" />
                    </div>
                    <div ref={setStatusSlot} className="px-3 pb-3 empty:hidden sm:px-4" />
                </div>
            </ManagedServerStatusSlotContext.Provider>
            <ManagedServerConsole serverId={server.serverId} operationState={server.operationState} observedGameState={server.observedGameState} />
            <div className="space-y-3 border-t border-white/10 p-3 sm:p-4">
                <form onSubmit={send} className="space-y-2">
                    <div className="flex gap-2">
                        <label htmlFor={id} className="sr-only">{t("commands.gameCommand")}</label>
                        <div className="relative min-w-0 flex-1">
                            <input
                                ref={inputRef} id={id} value={draft}
                                onChange={event => {
                                    const input = event.currentTarget;
                                    setDraft(input.value);
                                    setAtEnd(input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
                                    setFeedback(current => current?.kind === "invalid" ? null : current);
                                }}
                                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                                onSelect={event => {
                                    const input = event.currentTarget;
                                    setAtEnd(input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
                                }}
                                onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)} onKeyDown={completeWithTab}
                                disabled={!ready} maxLength={MAXIMUM_CONSOLE_COMMAND_LENGTH} title={ready ? t("commands.enterOneCoopCommand") : t("commands.commandsRequireOwnerOrManagerAccessAndARunningHealthy")}
                                autoComplete="off" aria-autocomplete="inline" aria-describedby={describedBy} aria-invalid={feedback?.kind === "invalid" ? true : undefined} spellCheck={false} placeholder="coop.…"
                                className="min-h-11 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-gold focus:ring-1 focus:ring-gold disabled:opacity-40 aria-[invalid=true]:border-red-400/70"
                            />
                            {completion && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2.5 font-mono text-sm whitespace-pre"><div style={{ transform: `translateX(-${scrollLeft}px)` }}><span className="invisible">{draft}</span><span className="text-foreground-muted">{completion}</span></div></div>}
                        </div>
                        <button type="submit" className={button} disabled={!ready || !draft.trim()} aria-busy={sending > 0 ? true : undefined}>
                            {sending > 0 && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                            {sending > 0 ? t("commands.sending") : t("commands.send")}
                        </button>
                    </div>
                    <div id={`${id}-feedback`} aria-live="polite" className="empty:hidden">
                        {feedback && (feedback.kind === "sent"
                            ? <p className="text-sm leading-6 text-foreground-muted">{feedback.text}</p>
                            : <p role="alert" className="text-sm leading-6 text-red-300">{feedback.text}</p>)}
                    </div>
                </form>
                <p id={`${id}-shortcuts`} className="text-xs text-foreground-muted">{rich("commands.sendShortcut", { key: <kbd className="font-mono">{t("commands.enter")}</kbd> })}</p>
            </div>
        </section>
    </ServerConsoleWorkspace>;
}
