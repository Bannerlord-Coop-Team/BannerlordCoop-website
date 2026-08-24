"use client";

import {
    containerOperationConfirmations,
    containerOperationLabels,
    type ContainerOperation,
    type ContainerState,
    LiveServerOperationButtons,
} from "@/app/components/servers/LiveServerOperationButtons";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import {
    CircleAlert,
    CircleCheck,
    Eraser,
    LoaderCircle,
    Plug,
    Send,
    Unplug,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

const MAX_CONSOLE_CHARS = 300_000;

type ConnectionStatus =
    | "unavailable"
    | "connecting"
    | "authorizing"
    | "attaching"
    | "connected"
    | "disconnected"
    | "error";

type GatewayMessage = {
    type?: string;
    data?: string;
    inputEnabled?: boolean;
    message?: string;
    ok?: boolean;
    operation?: ContainerOperation;
    state?: ContainerState;
    stream?: "stdout" | "stderr";
};

type TerminalSanitizerState = {
    pending: string;
};

const statusLabels: Record<ConnectionStatus, string> = {
    unavailable: "Not configured",
    connecting: "Connecting",
    authorizing: "Authorizing",
    attaching: "Attaching",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Connection error",
};

function sanitizeTerminalChunk(value: string, state: TerminalSanitizerState) {
    const input = `${state.pending}${value}`;
    state.pending = "";
    let output = "";

    for (let index = 0; index < input.length;) {
        const code = input.charCodeAt(index);

        if (code === 27) {
            if (index + 1 >= input.length) {
                state.pending = input.slice(index);
                break;
            }

            const sequenceType = input[index + 1];
            if (sequenceType === "[") {
                let end = index + 2;
                while (end < input.length) {
                    const finalCode = input.charCodeAt(end);
                    if (finalCode >= 0x40 && finalCode <= 0x7e) break;
                    end += 1;
                }
                if (end >= input.length) {
                    state.pending = input.slice(index);
                    break;
                }
                index = end + 1;
                continue;
            }

            if (sequenceType === "]") {
                let end = index + 2;
                while (end < input.length) {
                    if (input.charCodeAt(end) === 7) break;
                    if (input.charCodeAt(end) === 27 && input[end + 1] === "\\") {
                        end += 1;
                        break;
                    }
                    end += 1;
                }
                if (end >= input.length) {
                    state.pending = input.slice(index);
                    break;
                }
                index = end + 1;
                continue;
            }

            index += 2;
            continue;
        }

        if (code === 13) {
            if (input.charCodeAt(index + 1) !== 10) output += "\n";
            index += 1;
            continue;
        }
        if (code === 9 || code === 10) {
            output += input[index];
            index += 1;
            continue;
        }

        const codePoint = input.codePointAt(index) ?? code;
        const isBidiOrFormatControl =
            (codePoint >= 0x200b && codePoint <= 0x200f) ||
            (codePoint >= 0x202a && codePoint <= 0x202e) ||
            (codePoint >= 0x2060 && codePoint <= 0x206f) ||
            codePoint === 0xfeff;
        if (codePoint >= 32 && codePoint !== 127 && !isBidiOrFormatControl) {
            output += String.fromCodePoint(codePoint);
        }
        index += codePoint > 0xffff ? 2 : 1;
    }

    return output;
}

function decodeOutput(
    data: string,
    decoder: TextDecoder,
    sanitizer: TerminalSanitizerState,
) {
    const binary = window.atob(data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return sanitizeTerminalChunk(decoder.decode(bytes, { stream: true }), sanitizer);
}

export function LiveServerConsole({
    gatewayUrl,
    serverId,
}: {
    gatewayUrl: string | null;
    serverId: string;
}) {
    const [command, setCommand] = useState("");
    const [output, setOutput] = useState("");
    const [containerState, setContainerState] = useState<ContainerState>("unknown");
    const [controlsReady, setControlsReady] = useState(false);
    const [inputEnabled, setInputEnabled] = useState(false);
    const [pendingOperation, setPendingOperation] = useState<ContainerOperation | null>(null);
    const [status, setStatus] = useState<ConnectionStatus>(
        gatewayUrl ? "disconnected" : "unavailable",
    );
    const [statusMessage, setStatusMessage] = useState(
        gatewayUrl
            ? "Ready to connect to the console gateway."
            : "CONSOLE_GATEWAY_URL is not configured with a secure WebSocket URL.",
    );
    const socketRef = useRef<WebSocket | null>(null);
    const authorizedRef = useRef(false);
    const attemptRef = useRef(0);
    const decoderRef = useRef(new TextDecoder());
    const sanitizerRef = useRef<TerminalSanitizerState>({ pending: "" });
    const outputRef = useRef<HTMLPreElement | null>(null);
    const mountedRef = useRef(true);

    const appendOutput = useCallback((value: string) => {
        if (!value) return;
        setOutput((current) => `${current}${value}`.slice(-MAX_CONSOLE_CHARS));
    }, []);

    const appendNotice = useCallback((value: string) => {
        appendOutput(`\n[console] ${value}\n`);
    }, [appendOutput]);

    const disconnect = useCallback((showNotice = true) => {
        attemptRef.current += 1;
        const socket = socketRef.current;
        socketRef.current = null;
        authorizedRef.current = false;
        if (socket && socket.readyState < WebSocket.CLOSING) {
            socket.close(1000, "Admin disconnected");
        }
        if (mountedRef.current && gatewayUrl) {
            setContainerState("unknown");
            setControlsReady(false);
            setInputEnabled(false);
            setPendingOperation(null);
            setStatus("disconnected");
            setStatusMessage("Console disconnected.");
            if (showNotice) appendNotice("Disconnected.");
        }
    }, [appendNotice, gatewayUrl]);

    const connect = useCallback(async () => {
        if (!gatewayUrl) return;
        if (
            socketRef.current?.readyState === WebSocket.OPEN ||
            socketRef.current?.readyState === WebSocket.CONNECTING
        ) {
            return;
        }

        const attempt = ++attemptRef.current;
        authorizedRef.current = false;
        setContainerState("unknown");
        setControlsReady(false);
        setInputEnabled(false);
        setPendingOperation(null);
        setStatus("connecting");
        setStatusMessage("Opening the secure console connection…");

        let accessToken: string;
        try {
            const supabase = getSupabaseBrowserClient();
            const { data, error } = await supabase.auth.getSession();
            if (error || !data.session?.access_token) {
                throw new Error("Your Supabase session is no longer available. Sign in again.");
            }
            accessToken = data.session.access_token;
        } catch (error) {
            if (attempt !== attemptRef.current || !mountedRef.current) return;
            const message = error instanceof Error ? error.message : "Authentication failed.";
            setStatus("error");
            setStatusMessage(message);
            appendNotice(message);
            return;
        }

        if (attempt !== attemptRef.current || !mountedRef.current) return;

        decoderRef.current = new TextDecoder();
        sanitizerRef.current = { pending: "" };
        const socket = new WebSocket(gatewayUrl);
        socketRef.current = socket;

        socket.addEventListener("open", () => {
            if (attempt !== attemptRef.current) {
                socket.close();
                return;
            }
            setStatus("authorizing");
            setStatusMessage("Verifying the current Admin session…");
            socket.send(JSON.stringify({
                type: "authenticate",
                accessToken,
                serverId,
            }));
        });

        socket.addEventListener("message", (event) => {
            if (attempt !== attemptRef.current || typeof event.data !== "string") return;

            let message: GatewayMessage;
            try {
                message = JSON.parse(event.data) as GatewayMessage;
            } catch {
                return;
            }

            if (message.type === "ready") {
                authorizedRef.current = true;
                setControlsReady(true);
                setStatus("attaching");
                setStatusMessage("Admin verified. Loading container state…");
                appendNotice("Authenticated. Waiting for the container attach…");
                return;
            }

            if (message.type === "attached") {
                const writable = message.inputEnabled === true;
                setInputEnabled(writable);
                setStatus("connected");
                setStatusMessage(
                    writable
                        ? "Live container output and standard input are connected."
                        : "Live container output is connected. Stdin requires a container maintenance restart.",
                );
                appendNotice(
                    writable
                        ? "Container attached with stdin enabled."
                        : "Container attached read-only because Docker stdin is disabled.",
                );
                return;
            }

            if (message.type === "containerState" && message.state) {
                setContainerState(message.state);
                setInputEnabled(
                    message.state === "running" && message.inputEnabled === true,
                );

                if (message.state === "stopped") {
                    setStatus("connected");
                    setStatusMessage("Control channel connected. The container is stopped.");
                } else if (message.state === "error") {
                    setStatus("connected");
                    setStatusMessage(message.message ?? "The container state could not be loaded.");
                } else if (message.state !== "running") {
                    setStatus("connected");
                    setStatusMessage(
                        message.message ?? `Container operation: ${message.state}.`,
                    );
                }
                return;
            }

            if (message.type === "operationPending" && message.operation) {
                setPendingOperation(message.operation);
                if (message.message) {
                    setStatusMessage(message.message);
                    appendNotice(message.message);
                }
                return;
            }

            if (message.type === "operationResult" && message.operation) {
                setPendingOperation(null);
                const resultMessage = message.message ?? (
                    message.ok
                        ? `${containerOperationLabels[message.operation]} completed.`
                        : `${containerOperationLabels[message.operation]} failed.`
                );
                appendNotice(resultMessage);
                if (!message.ok) setStatusMessage(resultMessage);
                return;
            }

            if (message.type === "consoleClosed") {
                setInputEnabled(false);
                setStatus("connected");
                setStatusMessage(message.message ?? "The container output stream closed.");
                appendNotice(message.message ?? "Container output stream closed.");
                return;
            }

            if (message.type === "output" && message.data) {
                try {
                    appendOutput(decodeOutput(
                        message.data,
                        decoderRef.current,
                        sanitizerRef.current,
                    ));
                } catch {
                    appendNotice("A malformed output frame was ignored.");
                }
                return;
            }

            if (message.type === "error") {
                const errorMessage = message.message ?? "The console gateway reported an error.";
                setStatus(authorizedRef.current ? "connected" : "error");
                setStatusMessage(errorMessage);
                appendNotice(errorMessage);
                return;
            }

            if (message.type === "closed") {
                authorizedRef.current = false;
                setControlsReady(false);
                setInputEnabled(false);
                setPendingOperation(null);
                setStatus("disconnected");
                setStatusMessage(message.message ?? "The console session closed.");
                appendNotice(message.message ?? "Console session closed.");
            }
        });

        socket.addEventListener("error", () => {
            if (attempt !== attemptRef.current) return;
            setStatus("error");
            setStatusMessage("The secure console gateway could not be reached.");
        });

        socket.addEventListener("close", (event) => {
            if (attempt !== attemptRef.current) return;
            socketRef.current = null;
            authorizedRef.current = false;
            setContainerState("unknown");
            setControlsReady(false);
            setInputEnabled(false);
            setPendingOperation(null);
            const reason = event.reason || "The console connection closed.";
            setStatus(event.code === 1000 ? "disconnected" : "error");
            setStatusMessage(reason);
            appendNotice(reason);
        });
    }, [appendNotice, appendOutput, gatewayUrl, serverId]);

    useEffect(() => {
        mountedRef.current = true;
        void connect();

        return () => {
            mountedRef.current = false;
            disconnect(false);
        };
    }, [connect, disconnect]);

    useEffect(() => {
        if (!outputRef.current) return;
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }, [output]);

    function requestOperation(operation: ContainerOperation) {
        const socket = socketRef.current;
        if (
            !controlsReady ||
            pendingOperation ||
            socket?.readyState !== WebSocket.OPEN
        ) return;

        const confirmation = containerOperationConfirmations[operation];
        if (confirmation && !window.confirm(confirmation)) return;

        setPendingOperation(operation);
        if (operation !== "start") setInputEnabled(false);
        setStatusMessage(`${containerOperationLabels[operation]} operation requested…`);
        appendNotice(`${containerOperationLabels[operation]} operation requested.`);
        socket.send(JSON.stringify({ type: "operation", operation }));
    }

    function sendCommand(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const value = command.trim();
        const socket = socketRef.current;
        if (
            !value ||
            !consoleWritable ||
            socket?.readyState !== WebSocket.OPEN
        ) return;

        socket.send(JSON.stringify({ type: "input", data: `${value}\n` }));
        appendOutput(`\n> ${value}\n`);
        setCommand("");
    }

    const busy = status === "connecting" || status === "authorizing" || status === "attaching";
    const connected = status === "connected";
    const operationBusy = pendingOperation !== null;
    const consoleWritable = connected && containerState === "running" && inputEnabled;

    return (
        <section className="overflow-hidden rounded-sm border border-white/10 bg-[#050605]" aria-labelledby="container-console-heading">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <h2 id="container-console-heading" className="font-display text-2xl font-semibold text-foreground">
                            Container console
                        </h2>
                        <span className={`inline-flex items-center gap-1.5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${connected ? "text-emerald-300" : status === "error" ? "text-red-300" : "text-foreground-muted"}`}>
                            <span aria-hidden="true" className={`size-1.5 rounded-full ${connected ? "bg-emerald-400" : status === "error" ? "bg-red-400" : busy ? "animate-pulse bg-gold" : "bg-foreground-dim"}`} />
                            {statusLabels[status]}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-foreground-dim" aria-live="polite">{statusMessage}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setOutput("")}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-sm border border-white/15 bg-white/[0.03] px-3 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted transition-colors hover:border-white/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        <Eraser aria-hidden="true" className="size-3.5" /> Clear
                    </button>
                    {connected || busy ? (
                        <button
                            type="button"
                            onClick={() => disconnect()}
                            disabled={operationBusy}
                            title={operationBusy ? "Wait for the server operation to finish before disconnecting." : undefined}
                            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-sm border border-red-500/35 bg-red-500/10 px-3 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-red-200 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                            <Unplug aria-hidden="true" className="size-3.5" /> Disconnect
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => void connect()}
                            disabled={!gatewayUrl}
                            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-sm border border-gold/40 bg-gold/10 px-3 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:bg-gold/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Plug aria-hidden="true" className="size-3.5" />}
                            Connect
                        </button>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-4 border-b border-white/10 bg-background/70 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">
                        Container state
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                        <span className={`inline-flex items-center gap-1.5 font-label text-xs font-semibold uppercase tracking-[0.12em] ${containerStateStyle(containerState)}`}>
                            <span aria-hidden="true" className={`size-1.5 rounded-full ${containerStateDot(containerState)}`} />
                            {containerState}
                        </span>
                        {pendingOperation && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-gold">
                                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                                {containerOperationLabels[pendingOperation]} in progress
                            </span>
                        )}
                    </div>
                </div>

                <LiveServerOperationButtons
                    containerState={containerState}
                    controlsReady={controlsReady}
                    onOperation={requestOperation}
                    pendingOperation={pendingOperation}
                />
            </div>

            <pre
                ref={outputRef}
                role="log"
                aria-label="Live Bannerlord container output"
                tabIndex={0}
                className="h-[min(58vh,38rem)] min-h-80 overflow-auto whitespace-pre-wrap break-words px-4 py-4 font-mono text-xs leading-5 text-[#c7d5c4] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold sm:px-5 sm:text-[0.78rem]"
            >
                {output || "Waiting for container output…\n"}
            </pre>

            <form onSubmit={sendCommand} className="border-t border-white/10 bg-surface p-3 sm:p-4">
                <label htmlFor="console-command" className="sr-only">Send a command to the Bannerlord container</label>
                <div className="flex gap-2">
                    <span aria-hidden="true" className="flex min-h-11 items-center font-mono text-sm text-gold">&gt;</span>
                    <input
                        id="console-command"
                        value={command}
                        onChange={(event) => setCommand(event.target.value)}
                        disabled={!consoleWritable}
                        maxLength={4095}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={
                            consoleWritable
                                ? "Enter a server command"
                                : containerState === "stopped"
                                    ? "Start the container before sending commands"
                                    : connected
                                        ? "Container stdin is unavailable"
                                        : "Connect before sending commands"
                        }
                        className="min-h-11 min-w-0 flex-1 rounded-sm border border-white/15 bg-background px-3 font-mono text-sm text-foreground outline-none placeholder:text-foreground-dim hover:border-white/25 focus:border-gold focus:ring-1 focus:ring-gold/30 disabled:cursor-not-allowed disabled:opacity-45"
                    />
                    <button
                        type="submit"
                        disabled={!consoleWritable || !command.trim()}
                        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-sm border border-crimson bg-crimson px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Send aria-hidden="true" className="size-4" />
                        <span className="hidden sm:inline">Send</span>
                    </button>
                </div>
            </form>

            {!gatewayUrl && (
                <div className="flex gap-3 border-t border-gold/20 bg-gold/[0.07] px-4 py-3 text-xs leading-5 text-foreground-muted">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                    The admin page is ready, but the WSS gateway URL must be configured before it can attach to the remote container.
                </div>
            )}
            {consoleWritable && (
                <div className="flex gap-3 border-t border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-xs leading-5 text-emerald-100/75">
                    <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                    Commands are sent only to the allowlisted container stdin; this is not a host shell.
                </div>
            )}
            {connected && containerState === "running" && !inputEnabled && (
                <div className="flex gap-3 border-t border-gold/20 bg-gold/[0.07] px-4 py-3 text-xs leading-5 text-foreground-muted">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                    Container output is available, but stdin is not currently attached.
                </div>
            )}
        </section>
    );
}

function containerStateStyle(state: ContainerState) {
    if (state === "running") return "text-emerald-300";
    if (state === "error") return "text-red-300";
    if (["starting", "stopping", "restarting", "updating"].includes(state)) {
        return "text-gold";
    }
    return "text-foreground-muted";
}

function containerStateDot(state: ContainerState) {
    if (state === "running") return "bg-emerald-400";
    if (state === "error") return "bg-red-400";
    if (["starting", "stopping", "restarting", "updating"].includes(state)) {
        return "animate-pulse bg-gold";
    }
    return "bg-foreground-dim";
}
