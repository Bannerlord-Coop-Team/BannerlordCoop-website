"use client";

import { useManagedServerPolling } from "@/app/components/servers/ManagedServerPollingProvider";
import { operateManagedServer } from "@/app/servers/managed-server-actions";
import { Play, RotateCw, Square } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

const TRANSITIONAL_STATES = new Set([
    "provisioning",
    "configuring",
    "starting",
    "stopping",
    "maintenance",
    "updating",
    "deleting",
]);

type Operation = "start" | "stop" | "restart-game";

type ManagedServerControlsProps = {
    serverId: string;
    displayName: string;
    accessRole: "owner" | "manager" | "support" | "admin";
    operationState: string;
    expectedUpdatedAt: string;
};

export function ManagedServerControls({
    serverId,
    displayName,
    accessRole,
    operationState,
    expectedUpdatedAt,
}: ManagedServerControlsProps) {
    const [isPending, startTransition] = useTransition();
    const [pendingOperation, setPendingOperation] = useState<Operation | null>(null);
    const [message, setMessage] = useState("");
    const { session: pollingSession, beginPolling, endPolling } = useManagedServerPolling();
    const canOperate = accessRole === "owner" || accessRole === "manager";
    const stateIsTransitional = TRANSITIONAL_STATES.has(operationState);

    useEffect(() => {
        if (
            pollingSession === null
            || pollingSession.serverId !== serverId
            || pollingSession.statusSource !== "server"
            || stateIsTransitional
            || expectedUpdatedAt === pollingSession.initialUpdatedAt
        ) return;
        const timeout = window.setTimeout(() => endPolling(serverId), 0);
        return () => window.clearTimeout(timeout);
    }, [endPolling, expectedUpdatedAt, pollingSession, serverId, stateIsTransitional]);

    if (!canOperate) {
        return (
            <span className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-foreground-dim">
                Read-only access
            </span>
        );
    }

    const busy = isPending || stateIsTransitional || pollingSession !== null;
    const canStart = ["stopped", "failed", "degraded"].includes(operationState);
    const canStop = ["running", "starting", "failed", "degraded"].includes(operationState);
    const canRestart = ["running", "degraded"].includes(operationState);

    function requestOperation(operation: Operation) {
        if (operation === "stop" && !window.confirm(
            `Stop ${displayName}? Connected players will be disconnected.`,
        )) return;
        if (operation === "restart-game" && !window.confirm(
            `Restart ${displayName}? Connected players will be disconnected briefly.`,
        )) return;

        setMessage("");
        setPendingOperation(operation);
        startTransition(async () => {
            try {
                const result = await operateManagedServer({
                    serverId,
                    action: operation,
                    expectedUpdatedAt,
                    requestId: crypto.randomUUID(),
                });
                setMessage(result.message);
                if (result.ok) beginPolling(serverId, expectedUpdatedAt, result.jobId);
                else if (result.operationId) beginPolling(serverId, expectedUpdatedAt, result.operationId);
            } catch {
                setMessage("The server operation could not be submitted right now.");
            } finally {
                setPendingOperation(null);
            }
        });
    }

    return (
        <div className="flex flex-col items-start gap-2">
            <div className="grid grid-cols-3 gap-2 sm:flex">
                <ControlButton
                    label="Start"
                    icon={Play}
                    disabled={busy || !canStart}
                    pending={pendingOperation === "start"}
                    onClick={() => requestOperation("start")}
                />
                <ControlButton
                    label="Stop"
                    icon={Square}
                    disabled={busy || !canStop}
                    pending={pendingOperation === "stop"}
                    onClick={() => requestOperation("stop")}
                />
                <ControlButton
                    label="Restart"
                    icon={RotateCw}
                    disabled={busy || !canRestart}
                    pending={pendingOperation === "restart-game"}
                    onClick={() => requestOperation("restart-game")}
                />
            </div>
            {message && (
                <p
                    aria-live="polite"
                    className="max-w-xl text-left text-xs leading-5 text-foreground-muted"
                >
                    {message}
                </p>
            )}
        </div>
    );
}

function ControlButton({
    label,
    icon: Icon,
    disabled,
    pending,
    onClick,
}: {
    label: string;
    icon: typeof Play;
    disabled: boolean;
    pending: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-white/15 bg-white/[0.03] px-2 py-2 text-xs font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2 sm:px-3 sm:text-sm"
        >
            <Icon aria-hidden="true" className={`size-3.5 ${pending ? "animate-pulse" : ""}`} />
            {pending ? `${label}…` : label}
        </button>
    );
}
