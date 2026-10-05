"use client";

import { useTranslations } from "@/app/lib/localization/client";
import { useManagedConsoleSignals, type ManagedGamePhase } from "./ManagedServerPollingProvider";

import { ArrowDown, RotateCw } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";

const MAXIMUM_TEXT_CHARACTERS = 128 * 1_024;
const MAXIMUM_LINES = 2_000;
const MAXIMUM_SSE_FRAME_BYTES = 16 * 1_024;
const MAXIMUM_STATE_DETAIL_CHARACTERS = 500;
/** Waits between failed reconnects; once these run out the console offers a manual Reconnect. */
export const CONSOLE_RECONNECT_DELAYS = [2_000, 5_000, 10_000, 30_000, 60_000] as const;
/** A stream open this long counts as healthy, so its end starts a fresh backoff. */
const STABLE_CONNECTION_MILLISECONDS = 60_000;
/** Five-minute sessions renew automatically for about half an hour without page activity, then pause. */
export const MAXIMUM_IDLE_CONSOLE_RENEWALS = 6;
/** Logging the container host writes before the game's own output, such as podman cgroup warnings. */
const HOST_LOG_LINE = /^time="[^"]*" level=(?:debug|info|warning|warn) msg="/u;
const GAME_PHASES = new Set<ManagedGamePhase>(["boot", "loading", "serving", "stopping", "fatal"]);
/** Optional timestamp written before a control record, such as "[12:00:01] " or "2026-10-04T12:00:01Z ". */
const TIMESTAMP_PREFIX = /^[\d\s[\]:.,/TZ+-]{0,48}$/u;

type ConsoleState = "connecting" | "connected" | "reconnecting" | "stopped" | "idle" | "unavailable";
type ConsoleRun = "running" | "active" | "inactive";
type StreamHandle = { reconnect: () => void; activate: () => void; deactivate: () => void };

/** Monotonic across console instances so lifecycle progress can order streams. */
let consoleConnections = 0;

export type ConsoleControlLine =
    | { kind: "managed-command"; ok: boolean; output: string }
    | { kind: "state"; prefix: string; phase: ManagedGamePhase; detail?: string }
    | { kind: "hidden" };

/** Recognizes complete "@DS@" control records, optionally after a timestamp; other stdout stays untouched. */
export function parseConsoleControlLine(line: string): ConsoleControlLine | null {
    const marker = line.indexOf("@DS@");
    if (marker < 0 || !TIMESTAMP_PREFIX.test(line.slice(0, marker))) return null;
    let event: unknown;
    try {
        event = JSON.parse(line.slice(marker + 4));
    } catch {
        return null;
    }
    if (typeof event !== "object" || event === null || Array.isArray(event)) return null;
    const record = event as Record<string, unknown>;
    switch (record.ev) {
        case "managed-command":
            if (typeof record.id !== "string" || typeof record.ok !== "boolean" || typeof record.output !== "string") return null;
            return { kind: "managed-command", ok: record.ok, output: record.output };
        case "state": {
            if (typeof record.phase !== "string" || !GAME_PHASES.has(record.phase as ManagedGamePhase)) return null;
            const detail = typeof record.detail === "string" && record.detail.trim()
                ? record.detail.trim().slice(0, MAXIMUM_STATE_DETAIL_CHARACTERS) : undefined;
            return { kind: "state", prefix: line.slice(0, marker), phase: record.phase as ManagedGamePhase, ...(detail ? { detail } : {}) };
        }
        case "players":
            return Array.isArray(record.list) ? { kind: "hidden" } : null;
        case "commands":
            return Array.isArray(record.builtin) ? { kind: "hidden" } : null;
        default:
            return null;
    }
}

/** Hides container-host logging and control records that are incomplete, such as a truncated command list. */
export function isHiddenConsoleLine(line: string) {
    if (HOST_LOG_LINE.test(line)) return true;
    const marker = line.indexOf("@DS@");
    return marker >= 0 && TIMESTAMP_PREFIX.test(line.slice(0, marker));
}

/** Reports whether a scrolled element is showing its newest content, within a small tolerance. */
export function isScrolledToBottom(scrollTop: number, scrollHeight: number, clientHeight: number, tolerance = 24) {
    return scrollHeight - scrollTop - clientHeight <= tolerance;
}

/** Returns the wait before the next reconnect attempt, or null once automatic attempts are used up. */
export function consoleReconnectDelay(failedAttempts: number): number | null {
    return CONSOLE_RECONNECT_DELAYS[failedAttempts] ?? null;
}

/** Classifies whether the server has a game run whose output can be streamed. */
function consoleRun(operationState: string, observedGameState: string): ConsoleRun {
    if (operationState === "running" || observedGameState === "running") return "running";
    return operationState === "starting" || operationState === "degraded" ? "active" : "inactive";
}

/** Highlights command syntax as React text, without interpreting output as HTML. */
function highlightCommandOutput(output: string) {
    return output.split(/(coop\.[A-Za-z\d_.-]+|<[^<>\r\n]+>|^(?:Usage|Parameters|Note):)/gmu).map((part, index) => {
        if (index % 2 === 0) return part;
        const className = part.startsWith("coop.") ? "text-gold" : part.startsWith("<") ? "text-foreground-muted" : "font-semibold text-foreground";
        return <span key={index} className={className}>{part}</span>;
    });
}

/** Renders stdout in order, replacing recognized control records with readable status and command output. */
function ConsoleLines({ text }: { text: string }) {
    const { t } = useTranslations("managed-server");
    const lines = text.split("\n");
    return lines.map((line, index) => {
        const control = parseConsoleControlLine(line);
        const ending = index < lines.length - 1 ? "\n" : "";
        if (!control && isHiddenConsoleLine(line)) return null;
        if (!control) return <Fragment key={index}>{line}{ending}</Fragment>;
        if (control.kind === "hidden") return null;
        if (control.kind === "state") {
            const status = control.phase === "boot" ? t("console.serverStatusStartingUp")
                : control.phase === "loading" ? t("console.serverStatusLoadingCampaign")
                    : control.phase === "serving" ? t("console.serverStatusReadyToJoin")
                        : control.phase === "stopping" ? t("console.serverStatusShuttingDown")
                            : control.detail ? t("console.serverStatusStoppedByAnErrorDetail", { detail: control.detail })
                                : t("console.serverStatusStoppedByAnError");
            return <span key={index} className={control.phase === "fatal" ? "text-red-200" : control.phase === "serving" ? "text-gold" : "text-foreground-muted"}>{control.prefix}{status}{ending}</span>;
        }
        return <span key={index} role="group" aria-label={control.ok ? t("console.commandOutput") : t("console.commandError")} className={`my-2 block border-l-2 py-2 pr-3 pl-4 ${control.ok ? "border-gold/60 bg-gold/5" : "border-red-400/60 bg-red-400/5 text-red-200"}`}>{highlightCommandOutput(control.output)}{ending}</span>;
    });
}

/** Keeps one bounded stream open, renewing expired sessions and retrying failures with a capped backoff. */
function useConsoleStream(serverId: string, run: ConsoleRun) {
    const signals = useManagedConsoleSignals();
    const [state, setState] = useState<ConsoleState>("connecting");
    const [text, setText] = useState("");
    const runRef = useRef(run);
    const handleRef = useRef<StreamHandle | null>(null);

    useEffect(() => {
        runRef.current = run;
        if (run === "inactive") handleRef.current?.deactivate();
        else handleRef.current?.activate();
    }, [run]);

    useEffect(() => {
        const detach = signals?.attach(serverId);
        let controller: AbortController | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let failures = 0;
        let streaming = false;
        let waitingForVisibility = false;
        let idleRenewals = 0;
        let idle = false;

        // Opens a fresh stream; streams carry only new output, so reconnects append to what is shown.
        async function connect(mode: "initial" | "retry" | "renew") {
            clearTimeout(timer);
            timer = undefined;
            waitingForVisibility = false;
            controller?.abort();
            const current = new AbortController();
            controller = current;
            streaming = true;
            const connection = ++consoleConnections;
            const openedAt = Date.now();
            let ending: "ended" | "expired" | "failed" = "failed";
            let runEnded = false;
            if (mode === "initial") {
                setText("");
                setState("connecting");
            } else if (mode === "retry") {
                setState("reconnecting");
            }
            signals?.publish({ type: "opened", serverId, connection });
            try {
                const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/console`, {
                    headers: { accept: "text/event-stream" },
                    cache: "no-store",
                    signal: current.signal,
                });
                if (current.signal.aborted) return;
                if (!response.ok || response.body === null) throw new Error("unavailable");
                setState("connected");
                ending = "ended";
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8", { fatal: true });
                let pending = "";
                for (;;) {
                    const next = await reader.read();
                    if (current.signal.aborted) return;
                    const decoded = decodeConsoleStreamChunk(pending, next.done ? undefined : next.value, decoder, next.done);
                    pending = decoded.pending;
                    const lines: string[] = [];
                    for (const event of decoded.events) {
                        if (event.type === "line") {
                            lines.push(event.text);
                            const control = parseConsoleControlLine(event.text);
                            if (control?.kind === "state") signals?.publish({ type: "phase", serverId, connection, phase: control.phase, ...(control.detail ? { detail: control.detail } : {}) });
                        } else if (event.type === "expired") {
                            ending = "expired";
                        } else if (event.type === "ended") {
                            ending = "ended";
                            runEnded = true;
                        } else if (event.type === "truncated") {
                            ending = "failed";
                        }
                    }
                    if (lines.length > 0) setText((existing) => lines.reduce(boundedConsoleText, existing));
                    if (next.done) break;
                }
            } catch {
                if (current.signal.aborted) return;
                if (ending === "ended") ending = "failed";
            }
            if (current.signal.aborted) return;
            streaming = false;
            signals?.publish({ type: "closed", serverId, connection, runEnded });
            const stable = Date.now() - openedAt >= STABLE_CONNECTION_MILLISECONDS;
            if (stable) failures = 0;
            if (ending === "expired" && stable && idleRenewals >= MAXIMUM_IDLE_CONSOLE_RENEWALS) {
                // An unattended page stops holding a stream open; any activity resumes it.
                idle = true;
                setState("idle");
            } else if (ending === "expired" && stable) {
                idleRenewals += 1;
                reconnectWhenVisible("renew");
            } else if (runRef.current === "inactive") {
                setState("stopped");
            } else {
                scheduleRetry();
            }
        }

        // Reconnects now while the tab is visible; otherwise waits until the owner returns.
        function reconnectWhenVisible(mode: "retry" | "renew") {
            timer = undefined;
            if (document.visibilityState === "hidden") {
                waitingForVisibility = true;
                if (mode === "retry") setState("reconnecting");
                return;
            }
            void connect(mode);
        }

        // Retries after a bounded delay, then stops and offers a manual Reconnect.
        function scheduleRetry() {
            const delay = consoleReconnectDelay(failures);
            if (delay === null) {
                setState("unavailable");
                signals?.publish({ type: "unavailable", serverId });
                return;
            }
            failures += 1;
            setState("reconnecting");
            timer = setTimeout(() => reconnectWhenVisible("retry"), delay);
        }

        // Resumes a reconnect that was deferred while the tab was hidden.
        function resumeWhenVisible() {
            if (document.visibilityState === "visible" && waitingForVisibility) void connect("retry");
        }

        // Owner activity restarts the idle allowance and resumes a stream paused for inactivity.
        function markActive() {
            idleRenewals = 0;
            if (!idle) return;
            idle = false;
            if (runRef.current !== "inactive") void connect("retry");
        }

        handleRef.current = {
            reconnect() {
                failures = 0;
                idleRenewals = 0;
                idle = false;
                void connect("retry");
            },
            activate() {
                if (streaming) return;
                failures = 0;
                void connect("retry");
            },
            deactivate() {
                if (streaming) return;
                clearTimeout(timer);
                timer = undefined;
                waitingForVisibility = false;
                setState("stopped");
            },
        };
        document.addEventListener("visibilitychange", resumeWhenVisible);
        window.addEventListener("pointerdown", markActive);
        window.addEventListener("keydown", markActive);
        void connect("initial");
        return () => {
            handleRef.current = null;
            controller?.abort();
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", resumeWhenVisible);
            window.removeEventListener("pointerdown", markActive);
            window.removeEventListener("keydown", markActive);
            detach?.();
        };
    }, [serverId, signals]);

    return { state, text, reconnect: () => handleRef.current?.reconnect() };
}

/** Streams bounded current-run output, following the newest line unless the reader has scrolled back. */
export function ManagedServerConsole({ serverId, operationState = "running", observedGameState = "running" }: {
    serverId: string;
    operationState?: string;
    observedGameState?: string;
}) {
    const { t } = useTranslations("managed-server");
    const { state, text, reconnect } = useConsoleStream(serverId, consoleRun(operationState, observedGameState));
    const outputRef = useRef<HTMLPreElement>(null);
    const followingRef = useRef(true);
    const [following, setFollowing] = useState(true);
    const consoleStateMessages: Record<ConsoleState, string> = {
        connecting: t("console.connectingToLiveOutput"),
        connected: t("console.connectedWaitingForOutput"),
        reconnecting: t("console.reconnectingToLiveOutput"),
        stopped: t("console.theServerIsStoppedOutputWillAppearHereWhenIt"),
        idle: t("console.liveOutputPausedWhileThisPageWasIdleReconnectToKeepWatching"),
        unavailable: t("console.liveOutputIsnTAvailableRightNow"),
    };

    useLayoutEffect(() => {
        const output = outputRef.current;
        if (output && followingRef.current) output.scrollTop = output.scrollHeight;
    }, [text, state]);

    useEffect(() => {
        const output = outputRef.current;
        if (!output || typeof ResizeObserver === "undefined") return;
        // Hidden workspace tabs lose their scroll position; return to the newest line when shown or resized.
        const observer = new ResizeObserver(() => {
            if (followingRef.current) output.scrollTop = output.scrollHeight;
        });
        observer.observe(output);
        return () => observer.disconnect();
    }, []);

    // Follows new output only while the reader is already at the newest line.
    function trackScroll(event: UIEvent<HTMLPreElement>) {
        const output = event.currentTarget;
        const atBottom = isScrolledToBottom(output.scrollTop, output.scrollHeight, output.clientHeight);
        followingRef.current = atBottom;
        setFollowing(atBottom);
    }

    // Returns to the newest output and resumes following it.
    function jumpToLatest() {
        const output = outputRef.current;
        followingRef.current = true;
        setFollowing(true);
        if (output) output.scrollTop = output.scrollHeight;
    }

    const status = state === "connected" ? "" : consoleStateMessages[state];
    return (
        <div>
            <p id="console-stream-help" className="sr-only">{t("console.showsOutputFromTheServerSCurrentRunItReconnects")}</p>
            <div className="relative">
                <pre ref={outputRef} onScroll={trackScroll} aria-label={t("console.liveGameConsoleOutput")} aria-describedby="console-stream-help" tabIndex={0} className="h-64 overflow-auto whitespace-pre-wrap break-words bg-background p-4 font-mono text-[13px] leading-6 text-foreground outline-gold sm:h-[min(44vh,28rem)] sm:min-h-64">{text ? <ConsoleLines text={text} /> : consoleStateMessages[state]}{text && status ? <span className="text-foreground-muted">{`\n${status}`}</span> : null}</pre>
                {!following && text && <button type="button" onClick={jumpToLatest} className="absolute right-4 bottom-4 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gold/40 bg-surface/95 px-3 py-1.5 text-xs font-medium text-gold shadow-lg hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-gold">
                    <ArrowDown className="size-3.5" aria-hidden="true" />{t("console.jumpToLatest")}</button>}
            </div>
            {(state === "unavailable" || state === "idle") && <div className="flex justify-end border-t border-white/10 px-4 py-2">
                <button type="button" onClick={reconnect} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold focus-visible:outline-2 focus-visible:outline-gold">
                    <RotateCw className="size-4" aria-hidden="true" />{t("console.reconnect")}</button>
            </div>}
        </div>
    );
}

// Bounds retained console output without modifying command syntax.
export function boundedConsoleText(current: string, line: string): string {
    const combined = `${current}${line}\n`;
    const lines = combined.split("\n");
    const lineBounded = lines.length > MAXIMUM_LINES ? lines.slice(lines.length - MAXIMUM_LINES).join("\n") : combined;
    return lineBounded.length > MAXIMUM_TEXT_CHARACTERS
        ? lineBounded.slice(lineBounded.length - MAXIMUM_TEXT_CHARACTERS)
        : lineBounded;
}

// Decodes complete bounded console events while retaining partial frames.
export function decodeConsoleStreamChunk(
    previous: string,
    chunk: Uint8Array | undefined,
    decoder: TextDecoder,
    final = false,
): { pending: string; events: ReturnType<typeof parseConsoleEvent>[] } {
    let pending = previous + decoder.decode(chunk, { stream: !final });
    const events: ReturnType<typeof parseConsoleEvent>[] = [];
    for (;;) {
        const boundary = pending.indexOf("\n\n");
        if (boundary < 0) break;
        if (new TextEncoder().encode(pending.slice(0, boundary)).byteLength > MAXIMUM_SSE_FRAME_BYTES) throw new Error("Console event exceeded limit");
        events.push(parseConsoleEvent(pending.slice(0, boundary)));
        pending = pending.slice(boundary + 2);
    }
    if (new TextEncoder().encode(pending).byteLength > MAXIMUM_SSE_FRAME_BYTES || (final && pending.length > 0)) {
        throw new Error("Console event exceeded limit");
    }
    return { pending, events };
}

// Parses the existing event contract without translating server output.
export function parseConsoleEvent(frame: string): { type: "line"; text: string } | { type: "truncated" | "expired" | "ended" | "ignored" } {
    let type = "message";
    let data = "";
    for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) type = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (type === "line") {
        try {
            const value: unknown = JSON.parse(data);
            if (typeof value === "string" && value.length <= 16_384) return { type: "line", text: value };
        } catch { /* Ignore malformed upstream data. */ }
        return { type: "ignored" };
    }
    return type === "truncated" || type === "expired" || type === "ended" ? { type } : { type: "ignored" };
}
