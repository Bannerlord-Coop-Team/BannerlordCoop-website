"use client";

import { useTranslations } from "@/app/lib/localization/client";
import type { TranslationParams, Translator } from "@/app/lib/localization/types";

import { ServerConsoleWorkspace } from "./ServerManagementWorkspace";
import { DownloadServerLogButton } from "./DownloadServerLogButton";

import {
    containerOperationConfirmationKeys,
    containerOperationLabelKeys,
    type ContainerOperation,
    type ContainerState,
    LiveServerOperationButtons,
} from "@/app/components/servers/LiveServerOperationButtons";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { ArrowUpRight, ChevronDown, LoaderCircle, Plug, Unplug } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const MAX_CONSOLE_CHARS = 300_000;
const knownContainerStates = new Set<ContainerState>([
    "unknown", "error", "running", "starting", "stopped", "stopping", "restarting", "updating",
]);

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

const statusLabelKeys: Record<ConnectionStatus, string> = {
    unavailable: "console.status.unavailable",
    connecting: "console.status.connecting",
    authorizing: "console.status.authorizing",
    attaching: "console.status.attaching",
    connected: "console.status.connected",
    disconnected: "console.status.disconnected",
    error: "console.status.error",
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

/** Connects the authorized live console and localizes UI notices without altering gateway payloads. */
export function LiveServerConsole({
    gatewayUrl,
    serverId,
    logDownload,
}: {
    logDownload?: { serverId: string; userId: string };
    gatewayUrl: string | null;
    serverId: string;
}) {
    const translator = useTranslations("live-server");
    const { t } = translator;
    const translatorRef = useRef(translator);
    // Locale updates must not reconnect the socket or clear an in-flight operation.
    useEffect(() => { translatorRef.current = translator; }, [translator]);
    const [command, setCommand] = useState("");
    const commandRef = useRef<HTMLInputElement | null>(null);
    const [output, setOutput] = useState("");
    const [followingLogs, setFollowingLogs] = useState(true);
    const [containerState, setContainerState] = useState<ContainerState>("unknown");
    const [controlsReady, setControlsReady] = useState(false);
    const [inputEnabled, setInputEnabled] = useState(false);
    const [pendingOperation, setPendingOperation] = useState<ContainerOperation | null>(null);
    const [status, setStatus] = useState<ConnectionStatus>(
        gatewayUrl ? "disconnected" : "unavailable",
    );
    const [statusMessage, setStatusMessage] = useState<string | { key: string; params?: TranslationParams }>(
        { key: gatewayUrl ? "console.ready" : "console.notConfigured" },
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

    // Clears local connection state and presents a localized operator-disconnect notice.
    const disconnect = useCallback((showNotice = true) => {
        const { t } = translatorRef.current;
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
            setStatusMessage({ key: "console.disconnected" });
            if (showNotice) appendNotice(t("console.disconnectedNotice"));
        }
    }, [appendNotice, gatewayUrl]);

    // Authenticates and attaches the gateway while retaining external messages and output verbatim.
    const connect = useCallback(async () => {
        // Resolve callback notices against current messages without changing the transport lifecycle.
        const t: Translator["t"] = (key, params) => translatorRef.current.t(key, params);
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
        setStatusMessage({ key: "console.opening" });

        let accessToken: string;
        let sessionUnavailable = false;
        try {
            const supabase = getSupabaseBrowserClient(t("console.authenticationNotConfigured"));
            const { data, error } = await supabase.auth.getSession();
            if (error || !data.session?.access_token) {
                sessionUnavailable = true;
                throw new Error(t("console.sessionExpired"));
            }
            accessToken = data.session.access_token;
        } catch (error) {
            if (attempt !== attemptRef.current || !mountedRef.current) return;
            const message = error instanceof Error ? error.message : t("console.authenticationFailed");
            setStatus("error");
            setStatusMessage(sessionUnavailable
                ? { key: "console.sessionExpired" }
                : error instanceof Error ? message : { key: "console.authenticationFailed" });
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
            setStatusMessage({ key: "console.verifying" });
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
                setStatusMessage({ key: "console.loadingState" });
                appendNotice(t("console.authenticatedNotice"));
                return;
            }

            if (message.type === "attached") {
                const writable = message.inputEnabled === true;
                setInputEnabled(writable);
                setStatus("connected");
                setStatusMessage(
                    writable
                        ? { key: "console.attached" }
                        : { key: "console.attachedReadOnly" },
                );
                appendNotice(
                    writable
                        ? t("console.attachedNotice")
                        : t("console.readOnlyNotice"),
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
                    setStatusMessage({ key: "console.stopped" });
                } else if (message.state === "error") {
                    setStatus("connected");
                    setStatusMessage(message.message ?? { key: "console.stateUnavailable" });
                } else if (message.state !== "running") {
                    setStatus("connected");
                    setStatusMessage(
                        message.message ?? (knownContainerStates.has(message.state)
                            ? { key: `console.stateNotice.${message.state}` }
                            : { key: "console.externalStateNotice", params: { state: message.state } }),
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
                const resultKey = Object.hasOwn(containerOperationLabelKeys, message.operation)
                    ? `operation.${message.operation}.${message.ok ? "completed" : "failed"}`
                    : `operation.external.${message.ok ? "completed" : "failed"}`;
                const params = { operation: message.operation };
                appendNotice(message.message ?? t(resultKey, params));
                if (!message.ok) setStatusMessage(message.message ?? { key: resultKey, params });
                return;
            }

            if (message.type === "consoleClosed") {
                setInputEnabled(false);
                setStatus("connected");
                setStatusMessage(message.message ?? { key: "console.outputClosed" });
                appendNotice(message.message ?? t("console.outputClosedNotice"));
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
                    appendNotice(t("console.malformedFrame"));
                }
                return;
            }

            if (message.type === "error") {
                const errorMessage = message.message ?? t("console.gatewayError");
                setStatus(authorizedRef.current ? "connected" : "error");
                setStatusMessage(message.message ?? { key: "console.gatewayError" });
                appendNotice(errorMessage);
                return;
            }

            if (message.type === "closed") {
                authorizedRef.current = false;
                setControlsReady(false);
                setInputEnabled(false);
                setPendingOperation(null);
                setStatus("disconnected");
                setStatusMessage(message.message ?? { key: "console.sessionClosed" });
                appendNotice(message.message ?? t("console.sessionClosedNotice"));
            }
        });

        socket.addEventListener("error", () => {
            if (attempt !== attemptRef.current) return;
            setStatus("error");
            setStatusMessage({ key: "console.unreachable" });
        });

        socket.addEventListener("close", (event) => {
            if (attempt !== attemptRef.current) return;
            socketRef.current = null;
            authorizedRef.current = false;
            setContainerState("unknown");
            setControlsReady(false);
            setInputEnabled(false);
            setPendingOperation(null);
            const reason = event.reason || t("console.connectionClosed");
            setStatus(event.code === 1000 ? "disconnected" : "error");
            setStatusMessage(event.reason || { key: "console.connectionClosed" });
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

    /** Confirms destructive operations and sends the unchanged operation code to the gateway. */
    function requestOperation(operation: ContainerOperation) {
        const socket = socketRef.current;
        if (
            !controlsReady ||
            pendingOperation ||
            socket?.readyState !== WebSocket.OPEN
        ) return;

        const confirmationKey = containerOperationConfirmationKeys[operation];
        if (confirmationKey && !window.confirm(t(confirmationKey))) return;

        setPendingOperation(operation);
        if (operation !== "start") setInputEnabled(false);
        setStatusMessage({ key: `operation.${operation}.requested` });
        appendNotice(t(`operation.${operation}.notice`));
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

    return <ServerConsoleWorkspace onSelectCommand={consoleWritable ? (value) => {
        setCommand(value);
        commandRef.current?.focus();
    } : undefined}><section className="min-w-0 rounded-lg border border-white/10 bg-surface" aria-labelledby="container-console-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <h2 id="container-console-heading" className="text-base font-semibold">{t("console.heading")}</h2>
            <DownloadServerLogButton {...logDownload} className={`${button} !border-transparent !bg-transparent !text-foreground-muted hover:!text-foreground`} />
        </div>
        <div className="border-b border-white/10 px-5 py-3">
            <LiveServerOperationButtons controlsReady={controlsReady} onOperation={requestOperation} pendingOperation={pendingOperation} />
            {pendingOperation && <p role="status" className="mt-3 text-sm text-gold">{t(Object.hasOwn(containerOperationLabelKeys, pendingOperation) ? `operation.${pendingOperation}.progress` : "operation.external.progress", { operation: pendingOperation })}</p>}
        </div>
        <div className="relative">
            <pre ref={outputRef} onScroll={event => {
                const viewport = event.currentTarget;
                setFollowingLogs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 24);
            }} role="log" aria-label={t("console.outputLabel")} tabIndex={0} className="h-80 overflow-auto whitespace-pre-wrap break-words bg-surface-raised p-4 font-mono text-[13px] leading-7 text-foreground outline-gold sm:h-96 sm:p-5 sm:text-sm">{output || t("console.waiting")}</pre>
            {!followingLogs && <button type="button" className={`${button} absolute right-4 bottom-3 !bg-surface-raised shadow-lg`} onClick={() => setFollowingLogs(true)}>{t("console.latest")} <ChevronDown className="size-4" aria-hidden="true" /></button>}
        </div>
        <form onSubmit={sendCommand} className="flex gap-2 border-t border-white/10 p-5">
            <label htmlFor="console-command" className="sr-only">{t("console.command")}</label>
            <input ref={commandRef} id="console-command" value={command} onChange={event => setCommand(event.target.value)} disabled={!consoleWritable} maxLength={4095} autoComplete="off" spellCheck={false} placeholder={t("console.commandPlaceholder")} className="w-full min-w-0 rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold disabled:cursor-not-allowed disabled:opacity-40" />
            <button type="submit" disabled={!consoleWritable || !command.trim()} className={`${button} !border-gold/50 !bg-gold/15 !text-gold`}>{t("console.send")} <ArrowUpRight className="size-4" aria-hidden="true" /></button>
        </form>
        <div className="px-5 pb-5">
            <p className="text-xs leading-5 text-foreground-muted">{consoleWritable ? t("console.inputHint") : t("console.inputUnavailable")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
                <p role="status" className="min-w-0 flex-1 text-xs leading-5 text-foreground-muted">{t("console.statusSummary", { status: t(statusLabelKeys[status]), state: knownContainerStates.has(containerState) ? t(`console.state.${containerState}`) : containerState, message: typeof statusMessage === "string" ? statusMessage : t(statusMessage.key, statusMessage.params) })}</p>
                {connected || busy ? <button type="button" onClick={() => disconnect()} disabled={operationBusy} className={button}><Unplug className="size-4" aria-hidden="true" />{t("console.disconnect")}</button>
                    : <button type="button" onClick={() => void connect()} disabled={!gatewayUrl} className={button}>{busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Plug className="size-4" aria-hidden="true" />}{t("console.connect")}</button>}
            </div>
        </div>
    </section></ServerConsoleWorkspace>;
}
