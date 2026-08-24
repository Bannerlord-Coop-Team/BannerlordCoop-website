"use client";

import {
    containerOperationConfirmations,
    containerOperationLabels,
    type ContainerOperation,
    type ContainerState,
    LiveServerOperationButtons,
} from "@/app/components/servers/LiveServerOperationButtons";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ConnectionStatus = "unavailable" | "connecting" | "connected" | "disconnected" | "error";

type GatewayMessage = {
    type?: string;
    message?: string;
    ok?: boolean;
    operation?: ContainerOperation;
    state?: ContainerState;
};

export function LiveServerQuickControls({
    gatewayUrl,
    serverId,
}: {
    gatewayUrl: string | null;
    serverId: string;
}) {
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
        gatewayUrl ? "disconnected" : "unavailable",
    );
    const [containerState, setContainerState] = useState<ContainerState>("unknown");
    const [controlsReady, setControlsReady] = useState(false);
    const [pendingOperation, setPendingOperation] = useState<ContainerOperation | null>(null);
    const [statusMessage, setStatusMessage] = useState(
        gatewayUrl
            ? "Connecting to the live server…"
            : "The live-server gateway is not configured.",
    );
    const socketRef = useRef<WebSocket | null>(null);
    const attemptRef = useRef(0);
    const mountedRef = useRef(true);

    const connect = useCallback(async () => {
        if (!gatewayUrl) return;
        if (
            socketRef.current?.readyState === WebSocket.OPEN ||
            socketRef.current?.readyState === WebSocket.CONNECTING
        ) return;

        const attempt = ++attemptRef.current;
        setConnectionStatus("connecting");
        setContainerState("unknown");
        setControlsReady(false);
        setPendingOperation(null);
        setStatusMessage("Connecting to the live server…");

        let accessToken: string;
        try {
            const supabase = getSupabaseBrowserClient();
            const { data, error } = await supabase.auth.getSession();
            if (error || !data.session?.access_token) {
                throw new Error("Your Admin session is no longer available. Sign in again.");
            }
            accessToken = data.session.access_token;
        } catch (error) {
            if (attempt !== attemptRef.current || !mountedRef.current) return;
            setConnectionStatus("error");
            setStatusMessage(error instanceof Error ? error.message : "Authentication failed.");
            return;
        }

        if (attempt !== attemptRef.current || !mountedRef.current) return;

        const socket = new WebSocket(gatewayUrl);
        socketRef.current = socket;

        socket.addEventListener("open", () => {
            if (attempt !== attemptRef.current) {
                socket.close();
                return;
            }
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
                setControlsReady(true);
                setConnectionStatus("connected");
                setStatusMessage("Admin controls connected. Loading container state…");
                return;
            }

            if (message.type === "attached") {
                setConnectionStatus("connected");
                setStatusMessage("Live server controls are ready.");
                return;
            }

            if (message.type === "containerState" && message.state) {
                setContainerState(message.state);
                setConnectionStatus("connected");
                setStatusMessage(
                    message.message ?? (
                        message.state === "running"
                            ? "The live server is running."
                            : message.state === "stopped"
                                ? "The live server is stopped."
                                : `Container state: ${message.state}.`
                    ),
                );
                return;
            }

            if (message.type === "operationPending" && message.operation) {
                setPendingOperation(message.operation);
                setStatusMessage(
                    message.message ?? `${containerOperationLabels[message.operation]} is in progress…`,
                );
                return;
            }

            if (message.type === "operationResult" && message.operation) {
                setPendingOperation(null);
                setStatusMessage(
                    message.message ?? (
                        message.ok
                            ? `${containerOperationLabels[message.operation]} completed.`
                            : `${containerOperationLabels[message.operation]} failed.`
                    ),
                );
                return;
            }

            if (message.type === "error") {
                setStatusMessage(message.message ?? "The server gateway reported an error.");
                return;
            }

            if (message.type === "closed") {
                setControlsReady(false);
                setPendingOperation(null);
                setConnectionStatus("disconnected");
                setContainerState("unknown");
                setStatusMessage(message.message ?? "The server control session closed.");
            }
        });

        socket.addEventListener("error", () => {
            if (attempt !== attemptRef.current) return;
            setConnectionStatus("error");
            setStatusMessage("The secure live-server gateway could not be reached.");
        });

        socket.addEventListener("close", (event) => {
            if (attempt !== attemptRef.current || !mountedRef.current) return;
            socketRef.current = null;
            setControlsReady(false);
            setPendingOperation(null);
            setContainerState("unknown");
            setConnectionStatus(event.code === 1000 ? "disconnected" : "error");
            setStatusMessage(event.reason || "The live-server control connection closed.");
        });
    }, [gatewayUrl, serverId]);

    useEffect(() => {
        mountedRef.current = true;
        void connect();

        return () => {
            mountedRef.current = false;
            attemptRef.current += 1;
            const socket = socketRef.current;
            socketRef.current = null;
            if (socket && socket.readyState < WebSocket.CLOSING) {
                socket.close(1000, "Admin left the server page");
            }
        };
    }, [connect]);

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
        setStatusMessage(`${containerOperationLabels[operation]} operation requested…`);
        socket.send(JSON.stringify({ type: "operation", operation }));
    }

    const reconnectAvailable =
        Boolean(gatewayUrl) &&
        (connectionStatus === "disconnected" || connectionStatus === "error");

    return (
        <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="font-label text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">
                    Container state
                </p>
                <span className={`inline-flex items-center gap-1.5 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] ${containerStateStyle(containerState)}`}>
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${containerStateDot(containerState)}`} />
                    {connectionStatus === "connecting" ? "connecting" : containerState}
                </span>
                {pendingOperation && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-gold">
                        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                        {containerOperationLabels[pendingOperation]} in progress
                    </span>
                )}
                {reconnectAvailable && (
                    <button
                        type="button"
                        onClick={() => void connect()}
                        className="inline-flex min-h-7 items-center gap-1.5 rounded-sm border border-white/15 px-2 font-label text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted transition-colors hover:border-white/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        <RefreshCw aria-hidden="true" className="size-3" /> Retry
                    </button>
                )}
            </div>

            <LiveServerOperationButtons
                className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
                containerState={containerState}
                controlsReady={controlsReady}
                onOperation={requestOperation}
                pendingOperation={pendingOperation}
            />

            <p className="mt-2 min-h-5 text-xs leading-5 text-foreground-dim" aria-live="polite">
                {statusMessage}
            </p>
        </div>
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
