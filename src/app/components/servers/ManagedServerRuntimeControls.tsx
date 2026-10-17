"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { FastForward, Pause, Play, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import { submitManagedConsoleCommand } from "@/app/servers/managed-server-console-actions";
import { SAVE_CONSOLE_COMMAND, parseConsoleSubmission } from "../../../../supabase/functions/_shared/server-console-contract";
import { useManagedConsoleSignals, useManagedServerStatusSlot, type CampaignSpeed } from "./ManagedServerPollingProvider";
import { segmentedButtonClass, segmentedGroupClass, toolbarButtonClass } from "./segmented-controls";

/** The game's set_time_mode arguments for each speed. */
const SPEED_COMMANDS: Record<CampaignSpeed, string> = {
    pause: "coop.debug.set_time_mode Pause",
    "play-1x": "coop.debug.set_time_mode Play_1x",
    "play-2x": "coop.debug.set_time_mode Play_2x",
};
/** The dedicated server's own world save; the game's native save commands are suppressed on this host. */
const SAVE_COMMAND = SAVE_CONSOLE_COMMAND;
const NOTICE_MILLISECONDS = 6_000;

type Notice = { kind: "sent" | "error"; text: string };

/**
 * Campaign speed and on-demand save, sent as the same console commands an owner could type. Both need a running
 * game; the selected speed follows the server's own pulse and command results rather than the last click alone.
 */
export function ManagedServerRuntimeControls({ server, userId, ready }: { server: MyServerSummary; userId: string; ready: boolean }) {
    const { t } = useTranslations("managed-server");
    const signals = useManagedConsoleSignals();
    const statusSlot = useManagedServerStatusSlot();
    const [reportedSpeed, setReportedSpeed] = useState<CampaignSpeed | null>(null);
    const [pending, setPending] = useState<CampaignSpeed | "save" | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const speed = ready ? reportedSpeed : null;

    useEffect(() => {
        if (signals === null) return;
        return signals.subscribe((signal) => {
            if (signal.type !== "speed" || signal.serverId !== server.serverId) return;
            setReportedSpeed(signal.speed);
            // The game can refuse a speed, most often keeping the campaign paused until a player joins.
            if (signal.heldBy) setNotice({ kind: "sent", text: signal.heldBy === "no-players"
                ? t("runtime.theCampaignStaysPausedUntilAPlayerJoins")
                : t("runtime.theServerIsHoldingTheCampaignAtThisSpeed") });
        });
    }, [signals, server.serverId, t]);

    useEffect(() => {
        if (notice === null) return;
        const timeout = setTimeout(() => setNotice(current => current === notice ? null : current), NOTICE_MILLISECONDS);
        return () => clearTimeout(timeout);
    }, [notice]);

    /** Sends one runtime command and reports where its result will appear. */
    async function send(action: CampaignSpeed | "save") {
        if (!ready || pending !== null) return;
        const command = action === "save" ? SAVE_COMMAND : SPEED_COMMANDS[action];
        setPending(action);
        setNotice(null);
        try {
            const input = parseConsoleSubmission({ serverId: server.serverId, command, expectedUpdatedAt: server.updatedAt });
            const response = await submitManagedConsoleCommand(input, crypto.randomUUID(), userId);
            if (response.ok) {
                if (action !== "save") setReportedSpeed(action);
                setNotice({ kind: "sent", text: t("runtime.sentCommandOutputAppearsBelow", { command }) });
            } else {
                setNotice({ kind: "error", text: response.uncertain
                    ? t("commands.weCouldnTConfirmCommandWasDeliveredIfNoOutput", { command })
                    : response.message });
            }
        } catch {
            setNotice({ kind: "error", text: t("commands.weCouldnTConfirmCommandWasDeliveredIfNoOutput", { command }) });
        } finally {
            setPending(null);
        }
    }

    const unavailable = ready ? undefined : t("runtime.startTheServerToChangeSpeedOrSave");
    const speeds: { speed: CampaignSpeed; icon: typeof Play; label: string; text?: string }[] = [
        { speed: "pause", icon: Pause, label: t("runtime.pause"), text: t("runtime.pause") },
        { speed: "play-1x", icon: Play, label: t("runtime.playAtNormalSpeed"), text: "1×" },
        { speed: "play-2x", icon: FastForward, label: t("runtime.playAtDoubleSpeed"), text: "2×" },
    ];
    const status = notice && (notice.kind === "sent"
        ? <p aria-live="polite" className="max-w-xl text-left text-xs leading-5 text-foreground-muted">{notice.text}</p>
        : <p role="alert" className="max-w-xl text-left text-xs leading-5 text-red-300">{notice.text}</p>);

    return (
        <>
            <div role="group" aria-label={t("runtime.campaignSpeed")} title={unavailable} className={segmentedGroupClass}>
                {speeds.map(({ speed: choice, icon: Icon, label, text }) => (
                    <button key={choice} type="button" className={segmentedButtonClass}
                        aria-label={label} aria-pressed={speed === choice} disabled={!ready || pending !== null}
                        onClick={() => void send(choice)}>
                        <Icon aria-hidden="true" className={`size-3.5 ${pending === choice ? "animate-pulse" : ""}`} />
                        <span aria-hidden="true">{text}</span>
                    </button>
                ))}
            </div>
            <button type="button" className={toolbarButtonClass} title={unavailable} disabled={!ready || pending !== null}
                onClick={() => void send("save")}>
                <Save aria-hidden="true" className={`size-3.5 ${pending === "save" ? "animate-pulse" : ""}`} />
                {pending === "save" ? `${t("runtime.save")}…` : t("runtime.save")}
            </button>
            {status && (statusSlot === undefined ? status : statusSlot ? createPortal(status, statusSlot) : null)}
        </>
    );
}
