"use client";

import { operateManagedServer } from "@/app/servers/managed-server-actions";
import { Power, RotateCw, Square } from "lucide-react";
import { useRouter } from "next/navigation";
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
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [pendingOperation, setPendingOperation] = useState<Operation | null>(null);
    const [message, setMessage] = useState("");
    const [pollingFromState, setPollingFromState] = useState<string | null>(null);
    const canOperate = accessRole === "owner" || accessRole === "manager";
    const stateIsTransitional = TRANSITIONAL_STATES.has(operationState);

    useEffect(() => {
        if (pollingFromState === null && !stateIsTransitional) return;
        if (
            pollingFromState !== null
            && operationState !== pollingFromState
            && !stateIsTransitional
        ) return;
        const interval = window.setInterval(() => router.refresh(), 4_000);
        const timeout = window.setTimeout(() => setPollingFromState(null), 60_000);
        return () => {
            window.clearInterval(interval);
            window.clearTimeout(timeout);
        };
    }, [operationState, pollingFromState, router, stateIsTransitional]);

    if (!canOperate) {
        return (
            <span className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-foreground-dim">
                Read-only access
            </span>
        );
    }

    const busy = isPending || stateIsTransitional;
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
            const result = await operateManagedServer({
                serverId,
                action: operation,
                expectedUpdatedAt,
                requestId: crypto.randomUUID(),
            });
            setMessage(result.message);
            setPendingOperation(null);
            if (result.ok) {
                setPollingFromState(operationState);
                router.refresh();
            }
        });
    }

    return (
        <div className="flex min-w-72 flex-col items-end gap-2">
            <div className="flex items-center justify-end gap-2">
                <ControlButton
                    label="Start"
                    icon={Power}
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
                    className="max-w-72 text-right text-xs leading-5 text-foreground-muted"
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
    icon: typeof Power;
    disabled: boolean;
    pending: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 border border-gold/35 bg-gold/[0.07] px-3 font-label text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-foreground-dim"
        >
            <Icon aria-hidden="true" className={`size-3.5 ${pending ? "animate-pulse" : ""}`} />
            {pending ? `${label}…` : label}
        </button>
    );
}
