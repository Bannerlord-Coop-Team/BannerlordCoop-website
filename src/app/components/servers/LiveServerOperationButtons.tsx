"use client";

import {
    Download,
    LoaderCircle,
    Play,
    RotateCw,
    Square,
} from "lucide-react";

export type ContainerOperation = "start" | "stop" | "restart" | "update";
export type ContainerState =
    | "unknown"
    | "error"
    | "running"
    | "starting"
    | "stopped"
    | "stopping"
    | "restarting"
    | "updating";

export const containerOperationLabels: Record<ContainerOperation, string> = {
    start: "Start",
    stop: "Stop",
    restart: "Restart",
    update: "Update",
};

export const containerOperationConfirmations: Partial<Record<ContainerOperation, string>> = {
    stop: "Stop the live Bannerlord server? Connected players will be disconnected.",
    restart: "Restart the live Bannerlord server? Connected players will be disconnected briefly.",
    update: "Check for and apply the latest configured server image? If a new image exists, the container will be recreated and connected players will be disconnected. The previous container is retained for rollback.",
};

export function LiveServerOperationButtons({
    className = "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap",
    containerState,
    controlsReady,
    onOperation,
    pendingOperation,
}: {
    className?: string;
    containerState: ContainerState;
    controlsReady: boolean;
    onOperation: (operation: ContainerOperation) => void;
    pendingOperation: ContainerOperation | null;
}) {
    const operationBusy = pendingOperation !== null;

    return (
        <div className={className} aria-label="Live server operations">
            <OperationButton
                icon={Play}
                label="Start"
                onClick={() => onOperation("start")}
                disabled={!controlsReady || operationBusy || containerState !== "stopped"}
                pending={pendingOperation === "start"}
                tone="success"
            />
            <OperationButton
                icon={Square}
                label="Stop"
                onClick={() => onOperation("stop")}
                disabled={!controlsReady || operationBusy || containerState !== "running"}
                pending={pendingOperation === "stop"}
                tone="danger"
            />
            <OperationButton
                icon={RotateCw}
                label="Restart"
                onClick={() => onOperation("restart")}
                disabled={!controlsReady || operationBusy || containerState !== "running"}
                pending={pendingOperation === "restart"}
                tone="warning"
            />
            <OperationButton
                icon={Download}
                label="Update"
                onClick={() => onOperation("update")}
                disabled={!controlsReady || operationBusy || containerState !== "running"}
                pending={pendingOperation === "update"}
                tone="default"
            />
        </div>
    );
}

function OperationButton({
    disabled,
    icon: Icon,
    label,
    onClick,
    pending,
    tone,
}: {
    disabled: boolean;
    icon: typeof Play;
    label: string;
    onClick: () => void;
    pending: boolean;
    tone: "default" | "success" | "warning" | "danger";
}) {
    const toneStyles = {
        default: "border-sky-400/35 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20 focus-visible:ring-sky-300",
        success: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 focus-visible:ring-emerald-300",
        warning: "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 focus-visible:ring-gold",
        danger: "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 focus-visible:ring-red-400",
    } as const;

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-35 ${toneStyles[tone]}`}
        >
            {pending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
                <Icon aria-hidden="true" className="size-4" />
            )}
            {label}
        </button>
    );
}
