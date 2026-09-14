"use client";

import { DownloadServerLogButton } from "./DownloadServerLogButton";

import {
    containerOperationConfirmations,
    containerOperationLabels,
    type ContainerOperation,
    type ContainerState,
    LiveServerOperationButtons,
} from "@/app/components/servers/LiveServerOperationButtons";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { ArrowUpRight, ChevronDown, LoaderCircle, Plug, Unplug } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
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
    logDownload,
}: {
    logDownload?: { serverId: string; userId: string };
    gatewayUrl: string | null;
    serverId: string;
}) {
    const [command, setCommand] = useState("");
    const [output, setOutput] = useState("");
    const [followingLogs, setFollowingLogs] = useState(true);
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
            socket.close(1000, "Operator disconnected");
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
            setStatusMessage("Verifying your server access…");
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
                setStatusMessage("Server access verified. Loading container state…");
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
        if (!outputRef.current || !followingLogs) return;
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }, [output, followingLogs]);

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

    return <section className="min-w-0 rounded-lg border border-white/10 bg-surface" aria-labelledby="container-console-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <h2 id="container-console-heading" className="text-base font-semibold">Console</h2>
            <DownloadServerLogButton {...logDownload} />
        </div>
        <div className="border-b border-white/10 px-5 py-3">
            <LiveServerOperationButtons controlsReady={controlsReady} onOperation={requestOperation} pendingOperation={pendingOperation} />
            {pendingOperation && <p role="status" className="mt-3 text-sm text-gold">{containerOperationLabels[pendingOperation]} in progress</p>}
        </div>
        <div className="relative">
            <pre ref={outputRef} onScroll={event => {
                const viewport = event.currentTarget;
                setFollowingLogs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 24);
            }} role="log" aria-label="Live Bannerlord container output" tabIndex={0} className="h-80 overflow-auto whitespace-pre-wrap break-words bg-surface-raised p-4 font-mono text-[13px] leading-7 text-foreground outline-gold sm:h-96 sm:p-5 sm:text-sm">{output || "Waiting for container output…"}</pre>
            {!followingLogs && <button type="button" className={`${button} absolute right-4 bottom-3 !bg-surface-raised shadow-lg`} onClick={() => setFollowingLogs(true)}>Jump to latest <ChevronDown className="size-4" aria-hidden="true" /></button>}
        </div>
        <form onSubmit={sendCommand} className="flex gap-2 border-t border-white/10 p-5">
            <label htmlFor="console-command" className="sr-only">Console command</label>
            <input id="console-command" value={command} onChange={event => setCommand(event.target.value)} disabled={!consoleWritable} maxLength={4095} autoComplete="off" spellCheck={false} placeholder="Enter a command…" className="w-full min-w-0 rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold disabled:cursor-not-allowed disabled:opacity-40" />
            <button type="submit" disabled={!consoleWritable || !command.trim()} className={`${button} !border-gold/50 !bg-gold/15 !text-gold`}>Send <ArrowUpRight className="size-4" aria-hidden="true" /></button>
        </form>
        <div className="px-5 pb-5">
            <p className="text-xs leading-5 text-foreground-muted">{consoleWritable ? "Enter to send · Commands go to container stdin, not a host shell." : "Console input is unavailable until the running container is connected with stdin enabled."}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
                <p role="status" className="min-w-0 flex-1 text-xs leading-5 text-foreground-muted">{statusLabels[status]} · {containerState} · {statusMessage}</p>
                {connected || busy ? <button type="button" onClick={() => disconnect()} disabled={operationBusy} className={button}><Unplug className="size-4" aria-hidden="true" />Disconnect</button>
                    : <button type="button" onClick={() => void connect()} disabled={!gatewayUrl} className={button}>{busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Plug className="size-4" aria-hidden="true" />}Connect</button>}
            </div>
        </div>
    </section>;
}
