"use client";

import { useManagedServerPolling } from "@/app/components/servers/ManagedServerPollingProvider";
import { operateManagedServer, setManagedServerPassword } from "@/app/servers/managed-server-actions";
import { Download, Play, RotateCw, Square } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";

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

/** Provides confirmed lifecycle operations without mixing in server configuration. */
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

    /** Confirms disruptive operations and reports the existing action result. */
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
            <div className="flex flex-wrap gap-2">
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

/** Owns the owner-only password form in Settings, preserving confirmation and pending guards. */
export function ManagedServerPassword({ serverId, accessRole, operationState, expectedUpdatedAt }: Omit<ManagedServerControlsProps, "displayName">) {
    const [isPending, startTransition] = useTransition();
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const { session: pollingSession } = useManagedServerPolling();
    const busy = isPending || TRANSITIONAL_STATES.has(operationState) || pollingSession !== null;
    if (accessRole !== "owner") return null;

    /** Applies a confirmed password change once and clears the sensitive draft after the response. */
    function savePassword(event: FormEvent<HTMLFormElement>) {
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
    }

    return <section aria-labelledby="game-password-heading" className="rounded-lg border border-white/10 bg-surface p-5">
        <h2 id="game-password-heading" className="text-base font-semibold">Game password</h2>
        <p className="mt-1 text-sm leading-6 text-foreground-muted">Controls who can join the game. Changing it while running warns players and restarts the server.</p>
        <form onSubmit={savePassword} className="mt-4 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-medium">New game password
                <input className="mt-2 block min-h-11 w-full rounded-md border border-white/15 bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-40" type="password" autoComplete="new-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
            </label>
            <button type="submit" disabled={busy || !password} className="min-h-11 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40">{isPending ? "Saving…" : "Set password"}</button>
        </form>
        {message && <p role="status" className="mt-3 text-sm leading-6 text-foreground-muted">{message}</p>}
    </section>;
}

/** Renders a lifecycle action with consistent target size and pending feedback. */
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
