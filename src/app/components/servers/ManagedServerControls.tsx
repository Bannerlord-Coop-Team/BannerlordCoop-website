"use client";

import { useManagedServerPolling } from "@/app/components/servers/ManagedServerPollingProvider";
import { operateManagedServer, setManagedServerPassword } from "@/app/servers/managed-server-actions";
import { Download, Play, RotateCw, Square } from "lucide-react";
import { useState, useTransition } from "react";

const TRANSITIONAL_STATES = new Set([
    "provisioning",
    "configuring",
    "starting",
    "stopping",
    "maintenance",
    "updating",
    "deleting",
]);

type Operation = "start" | "stop" | "restart-game" | "update-now";

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
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const { session: pollingSession } = useManagedServerPolling();
    const canOperate = accessRole === "owner" || accessRole === "manager";
    const stateIsTransitional = TRANSITIONAL_STATES.has(operationState);

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
            `Stop ${displayName}? Players will be disconnected without a save-flush check or advance warning. Unsaved progress may be lost.`,
        )) return;
        if (operation === "restart-game" && !window.confirm(
            `Restart ${displayName}? Players will be disconnected without a save-flush check or advance warning. Unsaved progress may be lost.`,
        )) return;
        if (operation === "update-now" && !window.confirm(
            `Update ${displayName} now? A backup will be taken first. If the server is running, players will be disconnected while its selected release is installed.`,
        )) return;

        setMessage("");
        setPendingOperation(operation);
        startTransition(async () => {
            try {
                const result = await operateManagedServer({
                    serverId,
                    action: operation,
                    ...(operation === "update-now" ? { expectedUpdatedAt } : {}),
                });
                setMessage(result.message);
            } catch {
                setMessage("The command could not be confirmed. It may have executed. Refresh server status before sending another command.");
            } finally {
                setPendingOperation(null);
            }
        });
    }

    return (
        <div className="flex flex-col items-start gap-2">
            <div className="grid grid-cols-2 gap-2 sm:flex">
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
                <ControlButton
                    label="Update now"
                    icon={Download}
                    disabled={busy}
                    pending={pendingOperation === "update-now"}
                    onClick={() => requestOperation("update-now")}
                />
            </div>
            {accessRole === "owner" && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => {
                event.preventDefault();
                if (busy || !password) return;
                if (operationState === "running" && !window.confirm("Change the password and restart the server after warning players?")) return;
                setMessage("");
                startTransition(async () => {
                    try {
                        const result = await setManagedServerPassword({ serverId, expectedUpdatedAt, password });
                        setMessage(result.message);
                    } catch {
                        setMessage("The password change could not be confirmed. It may have applied. Refresh server status before trying again.");
                    } finally {
                        setPassword("");
                    }
                });
            }}>
                <label className="text-xs">New game password<input className="mt-1 block border border-white/20 bg-surface px-2 py-1" type="password" autoComplete="new-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
                <button type="submit" disabled={busy || !password} className="border border-white/20 px-3 py-1 text-xs disabled:opacity-50">Set password</button>
            </form>}
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
