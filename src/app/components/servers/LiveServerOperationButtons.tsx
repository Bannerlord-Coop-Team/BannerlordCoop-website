"use client";

import { useTranslations } from "@/app/lib/localization/client";

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

export const containerOperationLabelKeys: Record<ContainerOperation, string> = {
    start: "operation.start.label",
    stop: "operation.stop.label",
    restart: "operation.restart.label",
    update: "operation.update.label",
};

export const containerOperationConfirmationKeys: Partial<Record<ContainerOperation, string>> = {
    stop: "operation.stop.confirmation",
    restart: "operation.restart.confirmation",
    update: "operation.update.confirmation",
};

/** Presents localized controls while emitting unchanged container operation codes. */
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
    const { t } = useTranslations("live-server");
    const operationBusy = pendingOperation !== null;

    return (
        <div className={className} aria-label={t("operation.group")}>
            <OperationButton
                icon={Play}
                label={t(containerOperationLabelKeys.start)}
                onClick={() => onOperation("start")}
                disabled={!controlsReady || operationBusy}
                pending={pendingOperation === "start"}
                tone="success"
            />
            <OperationButton
                icon={Square}
                label={t(containerOperationLabelKeys.stop)}
                onClick={() => onOperation("stop")}
                disabled={!controlsReady || operationBusy}
                pending={pendingOperation === "stop"}
                tone="danger"
            />
            <OperationButton
                icon={RotateCw}
                label={t(containerOperationLabelKeys.restart)}
                onClick={() => onOperation("restart")}
                disabled={!controlsReady || operationBusy}
                pending={pendingOperation === "restart"}
                tone="warning"
            />
            <OperationButton
                icon={Download}
                label={t(containerOperationLabelKeys.update)}
                onClick={() => onOperation("update")}
                disabled={!controlsReady || operationBusy}
                pending={pendingOperation === "update"}
                tone="default"
            />
        </div>
    );
}

/** Displays one operation control and its pending indicator. */
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
