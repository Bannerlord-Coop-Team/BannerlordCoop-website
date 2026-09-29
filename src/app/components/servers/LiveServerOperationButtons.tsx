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
    controlsReady,
    onOperation,
    pendingOperation,
}: {
    className?: string;
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
                disabled={!controlsReady || operationBusy}
                pending={pendingOperation === "start"}
                tone="success"
            />
            <OperationButton
                icon={Square}
                label="Stop"
                onClick={() => onOperation("stop")}
                disabled={!controlsReady || operationBusy}
                pending={pendingOperation === "stop"}
                tone="danger"
            />
            <OperationButton
                icon={RotateCw}
                label="Restart"
                onClick={() => onOperation("restart")}
                disabled={!controlsReady || operationBusy}
                pending={pendingOperation === "restart"}
                tone="warning"
            />
            <OperationButton
                icon={Download}
                label="Update"
                onClick={() => onOperation("update")}
                disabled={!controlsReady || operationBusy}
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

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-white/15 bg-white/[0.03] px-2 py-2 text-xs font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2 sm:px-3 sm:text-sm ${tone === "success" ? "!border-gold/50 !bg-gold/15 !text-gold" : ""}`}
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
