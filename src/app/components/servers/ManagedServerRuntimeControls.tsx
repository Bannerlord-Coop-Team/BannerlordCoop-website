"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { FastForward, Pause, Play, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import { acknowledgeManagedConsoleCommand, checkManagedConsoleCommand, submitManagedConsoleCommand } from "@/app/servers/managed-server-console-actions";
import { SAVE_CONSOLE_COMMAND, parseConsoleSubmission, type ConsoleReference, type ConsoleResult } from "../../../../supabase/functions/_shared/server-console-contract";
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
/** Covers the runner's 60-second save deadline plus delivery, so a stuck save still ends in an answer. */
export const SAVE_RESULT_TIMEOUT_MILLISECONDS = 90_000;
const SAVE_RESULT_POLL_MILLISECONDS = 1_000;

type Notice = { kind: "sent" | "progress" | "saved" | "error"; text: string };

/** What a finished save command reported, read from the outcome line the dedicated server prints. */
export type SaveOutcome =
    | { kind: "saved"; milliseconds: number | null }
    | { kind: "skipped" | "failed"; reason: string | null }
    | { kind: "unsupported" | "unconfirmed" };

/** Reads a terminal console result for `save`; null while it is still pending. */
export function readSaveOutcome(result: ConsoleResult): SaveOutcome | null {
    if (result.status === "pending") return null;
    // A runner without on-demand save support rejects the raw command before it reaches the game.
    if (result.status === "failed") return result.errorCode === "invalid_request" ? { kind: "unsupported" } : { kind: "unconfirmed" };
    if (result.status === "cancelled") return { kind: "unconfirmed" };
    const line = result.output.split(/\r?\n/u).find(text => text.includes("operator save")) ?? "";
    const saved = /operator save: world saved to '[^']+' \((\d+) ms\)/u.exec(line);
    if (saved) return { kind: "saved", milliseconds: Number(saved[1]) };
    const skipped = /operator save skipped: (.+)$/u.exec(line);
    if (skipped) return { kind: "skipped", reason: skipped[1].trim() || null };
    // "FAILED (<result>; world keeps running)" names the result; "FAILED (world keeps running): <exception>" does not.
    const failed = /operator save FAILED \(([^;)]*)/u.exec(line);
    if (failed) return { kind: "failed", reason: failed[1].trim() === "world keeps running" ? null : failed[1].trim() || null };
    return { kind: "unconfirmed" };
}

/** Waits for the save's own result, then acknowledges it once shown so no later recovery notice repeats it. */
async function awaitSaveResult(reference: ConsoleReference, userId: string, isMounted: () => boolean): Promise<SaveOutcome> {
    const deadline = Date.now() + SAVE_RESULT_TIMEOUT_MILLISECONDS;
    while (isMounted() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, SAVE_RESULT_POLL_MILLISECONDS));
        // A failed read is retried: the save itself may still finish and be readable a moment later.
        const response = await checkManagedConsoleCommand(reference, userId).catch(() => null);
        if (!response?.ok) continue;
        const outcome = readSaveOutcome(response.result);
        if (outcome === null) continue;
        void acknowledgeManagedConsoleCommand(reference, userId).catch(() => undefined);
        return outcome;
    }
    return { kind: "unconfirmed" };
}

/**
 * Campaign speed and on-demand save, sent as the same console commands an owner could type. Both need a running
 * game; the selected speed follows the server's own pulse and command results rather than the last click alone.
 */
export function ManagedServerRuntimeControls({ server, userId, ready }: { server: MyServerSummary; userId: string; ready: boolean }) {
    const { t, number } = useTranslations("managed-server");
    const signals = useManagedConsoleSignals();
    const statusSlot = useManagedServerStatusSlot();
    const [reportedSpeed, setReportedSpeed] = useState<CampaignSpeed | null>(null);
    const [pending, setPending] = useState<CampaignSpeed | "save" | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const mounted = useRef(true);
    const speed = ready ? reportedSpeed : null;

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

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
        // Progress lasts until its result replaces it; errors stay until the next action so they cannot go unnoticed.
        if (notice === null || notice.kind === "progress" || notice.kind === "error") return;
        const timeout = setTimeout(() => setNotice(current => current === notice ? null : current), NOTICE_MILLISECONDS);
        return () => clearTimeout(timeout);
    }, [notice]);

    /** Turns a save outcome into the notice shown beside the controls. */
    function saveNotice(outcome: SaveOutcome): Notice {
        switch (outcome.kind) {
            case "saved": return { kind: "saved", text: outcome.milliseconds === null ? t("runtime.worldSaved")
                : t("runtime.worldSavedInSeconds", { seconds: number(outcome.milliseconds / 1_000, { maximumFractionDigits: 1 }) }) };
            case "skipped": return { kind: "error", text: outcome.reason
                ? t("runtime.saveSkippedReason", { reason: outcome.reason }) : t("runtime.saveSkipped") };
            case "failed": return { kind: "error", text: outcome.reason
                ? t("runtime.saveFailedReason", { reason: outcome.reason }) : t("runtime.saveFailed") };
            case "unsupported": return { kind: "error", text: t("runtime.thisServerCanTSaveOnDemandYet") };
            case "unconfirmed": return { kind: "error", text: t("runtime.weCouldnTConfirmTheSave") };
        }
    }

    /** Sends one runtime command; a save also waits for and reports its result. */
    async function send(action: CampaignSpeed | "save") {
        if (!ready || pending !== null) return;
        const command = action === "save" ? SAVE_COMMAND : SPEED_COMMANDS[action];
        setPending(action);
        setNotice(null);
        try {
            const input = parseConsoleSubmission({ serverId: server.serverId, command, expectedUpdatedAt: server.updatedAt });
            const requestId = crypto.randomUUID();
            const response = await submitManagedConsoleCommand(input, requestId, userId);
            if (!response.ok) {
                setNotice({ kind: "error", text: response.uncertain
                    ? t("commands.weCouldnTConfirmCommandWasDeliveredIfNoOutput", { command })
                    : response.message });
            } else if (action === "save") {
                setNotice({ kind: "progress", text: t("runtime.savingTheWorld") });
                const outcome = await awaitSaveResult({ serverId: input.serverId, jobId: response.result.jobId, commandRequestId: requestId },
                    userId, () => mounted.current);
                if (mounted.current) setNotice(saveNotice(outcome));
            } else {
                setReportedSpeed(action);
                setNotice({ kind: "sent", text: t("runtime.sentCommandOutputAppearsBelow", { command }) });
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
    const status = notice && (notice.kind === "error"
        ? <p role="alert" className="max-w-xl text-left text-xs leading-5 text-red-300">{notice.text}</p>
        : <p aria-live="polite" className={`max-w-xl text-left text-xs leading-5 ${notice.kind === "saved" ? "text-emerald-300" : "text-foreground-muted"}`}>{notice.text}</p>);

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
