"use client";

import { configurationImportMessages } from "@/app/servers/managed-server-messages";

import { useTranslations } from "@/app/lib/localization/client";
import type { Translator } from "@/app/lib/localization/types";

import { ServerSaveConfigPanels, fileButtonClass } from "./ServerSaveConfigPanels";
import { strToU8, zipSync } from "fflate";
import { Download, Upload, Info, X, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkManagedServerFile, downloadManagedServerSave, exportManagedServerConfig, readManagedServerFileStatus, submitManagedServerFile } from "@/app/servers/managed-server-file-actions";
import { readConfigurationFile, applyConfigurationImport, type ConfigurationPart } from "../../../../supabase/functions/_shared/configuration-file-import";
import { MAXIMUM_WEB_SAVE_BYTES, MAXIMUM_WEB_CONFIG_BYTES, isSaveFileBasename, isWebsiteSaveExport, requireUuid, requireFileTimestamp, type OwnerFileStatus, type OwnerFileResult } from "../../../../supabase/functions/_shared/server-file-contract";

type Intent = {
    requestId: string; serverId: string; expectedUpdatedAt: string;
    action: "import-save" | "export-save" | "import-config";
    fingerprints: string[]; displayName: string; saveId: string | null; configPart?: ConfigurationPart;
};
type Scope = "save" | "config";
const buttonClass = fileButtonClass;
const inputClass = "mt-2 block w-full min-w-0 border border-white/15 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";

// Validates the stored transfer identity without altering its operation fields.
export function readFileIntent(value: string | null, serverId: string): Intent | null {
    if (value === null) return null;
    if (value.length > 2048) throw new Error("Invalid pending transfer");
    const parsed = JSON.parse(value) as Intent;
    if (typeof parsed !== "object" || parsed === null || ![7, 8].includes(Object.keys(parsed).length)) throw new Error("Invalid pending transfer");
    requireUuid(parsed.requestId); requireUuid(parsed.serverId); requireFileTimestamp(parsed.expectedUpdatedAt);
    if (parsed.serverId !== serverId || !["import-save", "export-save", "import-config"].includes(parsed.action)
        || !Array.isArray(parsed.fingerprints) || parsed.fingerprints.length > 2
        || parsed.fingerprints.some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash))
        || typeof parsed.displayName !== "string" || parsed.displayName.length > 48) throw new Error("Invalid pending transfer");
    if ((parsed.action === "import-save" ? ![1, 2].includes(parsed.fingerprints.length) : parsed.fingerprints.length !== (parsed.action === "export-save" ? 0 : 1))) throw new Error("Invalid pending transfer");
    if (parsed.action === "export-save" && parsed.saveId === null) throw new Error("Invalid pending transfer");
    if (parsed.configPart !== undefined && !["server", "mod", "combined"].includes(parsed.configPart)) throw new Error("Invalid pending transfer");
    if (Object.keys(parsed).some((key) => !["requestId", "serverId", "expectedUpdatedAt", "action", "fingerprints", "displayName", "saveId", "configPart"].includes(key))) throw new Error("Invalid pending transfer");
    if (parsed.saveId !== null) requireUuid(parsed.saveId);
    return parsed;
}

// Names a downloaded save export after the server and local day, keeping the server-supplied extension.
export function saveExportFileName(serverName: string | undefined, serverFileName: string, now = new Date()) {
    const extension = /\.[a-z0-9]{1,16}$/iu.exec(serverFileName)?.[0] ?? ".zip";
    const slug = (serverName ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-").slice(0, 48).replace(/^-+|-+$/gu, "") || "server";
    const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
    return `${slug}-save-${day}${extension}`;
}

// Places transfer feedback in the card whose control started the transfer.
function transferScope(action: Intent["action"]): Scope {
    return action === "import-config" ? "config" : "save";
}

// Downloads the original bytes using the given filename.
function saveDownload(bytes: BlobPart, fileName: string) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = fileName;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type TransferProps = { userId: string; serverId: string; serverName?: string; status: OwnerFileStatus | null; canImportConfig: boolean; canEditConfig?: boolean; canExportSave: boolean };

// Keys transfer state to the current account and server.
export function ManagedServerTransfers(props: TransferProps) {
    return <TransferSession key={`${props.userId}:${props.serverId}`} {...props} />;
}

// Presents file imports and durable transfer progress with localized diagnostics.
function TransferSession({ userId, serverId, serverName, status, canImportConfig, canEditConfig = false, canExportSave }: TransferProps) {
    const { t, rich, number, locale } = useTranslations("managed-server");
    const router = useRouter();
    const storageKey = `managed-file-transfer:v1:${userId}:${serverId}`;
    const [ready, setReady] = useState(false);
    const [storageError, setStorageError] = useState(false);
    const [intent, setIntent] = useState<Intent | null>(null);
    const intentRef = useRef<Intent | null>(null);
    const [result, setResult] = useState<OwnerFileResult | null>(null);
    const [feedback, setFeedback] = useState<{ scope: Scope; text: string } | null>(null);
    const [isPending, startTransition] = useTransition();
    const [downloading, setDownloading] = useState(false);
    const [dialogKind, setDialogKind] = useState<"import-save" | "import-config" | null>(null);
    const [configPart, setConfigPart] = useState<ConfigurationPart>("server");
    const [ignoredSettings, setIgnoredSettings] = useState<string[]>([]);
    const [files, setFiles] = useState<File[]>([]);
    const [displayName, setDisplayName] = useState("");
    const [reviewUpdatedAt, setReviewUpdatedAt] = useState<string | null>(null);
    const [review, setReview] = useState<string[] | null>(null);
    const [dialogError, setDialogError] = useState("");
    const [deadline, setDeadline] = useState<number | null>(null);
    const [downloadLink, setDownloadLink] = useState<{ url: string; expiresAt: string } | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const submitting = useRef(false);
    const canTransferSave = status !== null && status.observedGameState === "stopped"
        && ["stopped", "awaiting-save"].includes(status.operationState);
    const blocked = !ready || storageError || isPending || intent !== null || status === null;

    // Shows transfer feedback beside the controls of the given card.
    function say(text: string, scope: Scope) {
        setFeedback({ scope, text });
    }

    // Persists the existing transfer intent before dispatch.
    function remember(next: Intent | null) {
        try {
            if (next) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey);
            intentRef.current = next; setIntent(next); return true;
        } catch { setStorageError(true); return false; }
    }

    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                const stored = readFileIntent(sessionStorage.getItem(storageKey), serverId);
                intentRef.current = stored; setIntent(stored); setReady(true);
                if (stored) setFeedback({ scope: transferScope(stored.action), text: t("transfers.aPreviousTransferIsSavedCheckItsStatusBeforeRetrying") });
            } catch { setStorageError(true); }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [storageKey, serverId]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialogKind && dialog && !dialog.open) dialog.showModal();
        if (!dialogKind && dialog?.open) dialog.close();
    }, [dialogKind]);

    // Presents the durable transfer result without changing its state transitions.
    function accept(next: OwnerFileResult | null) {
        const scope = next?.kind === "job" ? transferScope(next.action)
            : next?.kind === "configuration" ? "config" : transferScope(intentRef.current?.action ?? "export-save");
        setResult(next);
        if (next === null) { say(t("transfers.noAcceptedTransferWasFoundRetryTheSameRequestWith"), scope); return; }
        if (next.kind === "rejected") {
            say(t("transfers.theTransferWasRejectedBeforeAJobWasAcceptedCheck"), scope); remember(null); setDeadline(null); router.refresh();
        } else if (next.kind === "configuration") {
            say(t("transfers.settingsImportedIfTheServerIsRunningStopItAnd"), scope); remember(null); setDeadline(null); router.refresh();
        } else if (["succeeded", "failed", "cancelled"].includes(next.state)) {
            setDeadline(null); router.refresh();
            say(next.state === "succeeded" ? next.action === "export-save" ? t("transfers.yourSaveExportIsReadyToDownload") : t("transfers.campaignAddedYourCurrentCampaignIsUnchanged")
                : t("transfers.theTransferStateYourRequestIsRetainedForReference", { state: t(`transferState.${next.state}`) }), scope);
            if (next.state === "succeeded" && next.action === "import-save") remember(null);
        } else say(next.action === "export-save" ? t("transfers.preparingYourSaveExport") : t("transfers.validatingAndImportingYourCampaign"), scope);
    }

    useEffect(() => {
        if (deadline === null || intent === null) return;
        let cancelled = false;
        let timer: number;
        const scope = transferScope(intent.action);
        // Refreshes existing operation progress and reports localized connection feedback.
        async function poll() {
            if (Date.now() >= deadline!) {
                setDeadline(null); say(t("transfers.stillWaitingForConfirmationUseCheckStatusToContinue"), scope); return;
            }
            const response = await checkManagedServerFile(serverId, intent!.requestId, userId).catch(() => ({ ok: false as const, message: t("transfers.connectionInterruptedYourTransferRequestIsRetained") }));
            if (cancelled || intentRef.current?.requestId !== intent!.requestId) return;
            if (response.ok) {
                accept(response.result);
                if (response.result?.kind === "rejected" || response.result?.kind === "configuration" || response.result?.kind === "job"
                    && ["succeeded", "failed", "cancelled"].includes(response.result.state)) return;
            } else say(response.message, scope);
            timer = window.setTimeout(poll, 4_000);
        }
        timer = window.setTimeout(poll, 4_000);
        return () => { cancelled = true; window.clearTimeout(timer); };
        // Poll only the recorded request; UI renders do not restart its deadline.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deadline, intent?.requestId, serverId, userId]);

    // Opens the selected import flow without submitting files.
    function openImport(kind: "import-save" | "import-config") {
        const input = dialogRef.current?.querySelector<HTMLInputElement>('input[type="file"]');
        if (input) input.value = "";
        setFiles([]); setDisplayName(intentRef.current?.displayName ?? "");
        setConfigPart(intentRef.current ? intentRef.current.configPart ?? "combined" : "server");
        setIgnoredSettings([]); setReview(null); setDialogError(""); setDialogKind(kind);
    }

    // Validates selected files and prepares a localized import review.
    async function validateFiles() {
        if (dialogKind === "import-config") {
            if (files.length !== 1 || !files[0].name.endsWith(".json") || files[0].size > MAXIMUM_WEB_CONFIG_BYTES || files[0].size === 0) {
                throw new Error(t("transfers.chooseOneConfigurationJsonFileUpTo64Kib"));
            }
            const importedFile = readConfigurationFile(await files[0].text(), configPart, configurationImportMessages(t));
            setIgnoredSettings(importedFile.ignoredSettings);
            if (!status) throw new Error(t("transfers.refreshThePageToLoadYourCurrentSettings"));
            const imported = applyConfigurationImport(status.managedConfig, importedFile.input, configurationImportMessages(t));
            const changes: string[] = [];
            // Collects configuration differences without exposing ignored values.
            function compare(before: unknown, after: unknown, prefix: string) {
                if (after !== null && typeof after === "object") {
                    for (const [key, value] of Object.entries(after)) compare((before as Record<string, unknown> | undefined)?.[key], value, prefix ? `${prefix}.${key}` : key);
                } else if (before !== after) changes.push(t("transfers.settingChange", { setting: settingLabel(prefix.split(".").at(-1)!, t), before: settingValue(before, t, number), after: settingValue(after, t, number) }));
            }
            compare(status?.managedConfig, imported, "");
            return changes.length ? changes : [t("transfers.thisFileMatchesYourCurrentSettings")];
        }
        if (![1, 2].includes(files.length) || files.some((file) => file.size === 0)
            || files.reduce((total, file) => total + file.size, 0) > MAXIMUM_WEB_SAVE_BYTES) throw new Error(t("transfers.chooseASaveExportZipOrAMatchingSavAndJsonPair"));
        if (files.some((file) => !isSaveFileBasename(file.name))) throw new Error(t("transfers.useFilenamesContainingLettersNumbersSpacesUnderscoresHyphensAndA"));
        const save = files.find((file) => file.name.endsWith(".sav"));
        const websiteExport = files.length === 1 && isWebsiteSaveExport(files[0].name);
        if (!websiteExport && (!save || !files.some((file) => file.name === save.name.slice(0, -4) + ".json"))) throw new Error(t("transfers.theSavAndJsonFilenamesMustMatch"));
        if (displayName.trim().length < 3 || displayName.trim().length > 48) throw new Error(t("transfers.enterACampaignNameBetween3And48Characters"));
        if (/[\p{Cc}\p{Cf}]/u.test(displayName.trim())) throw new Error(t("transfers.theCampaignNameContainsInvisibleCharactersDeleteTheNameAnd"));
        return [t("transfers.thisAddsASeparateCampaignAfterServerValidation"), t("transfers.yourCurrentCampaignAndExistingSavesWillNotBeReplaced")];
    }

    // Hashes original file bytes to preserve transfer retry identity.
    async function fingerprints() {
        return Promise.all([...files].sort((a, b) => a.name.localeCompare(b.name)).map(async (file) => {
            const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
            return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
        }));
    }

    // Encodes a retained transfer request together with its original files.
    function transferForm(next: Intent) {
        const form = new FormData();
        for (const [key, value] of Object.entries(next)) if (typeof value === "string") form.set(key, value);
        if (next.action === "import-config") form.set("config", files[0]);
        if (next.action === "import-save") for (const file of files) form.append("files", file);
        return form;
    }

    // Submits the retained transfer request without changing operation inputs.
    function submit(action: Intent["action"]) {
        if (submitting.current || status === null) return;
        submitting.current = true;
        const scope = transferScope(action);
        startTransition(async () => {
            try {
                if (action === "import-config" && !intentRef.current && reviewUpdatedAt !== status.updatedAt) throw new Error(t("transfers.theServerSettingsChangedWhileThisScreenWasOpenGo"));
                if (action !== "export-save") await validateFiles();
                const hashes = action === "export-save" ? [] : await fingerprints();
                const previous = intentRef.current;
                const next: Intent = previous ?? { requestId: crypto.randomUUID(), serverId, expectedUpdatedAt: status.updatedAt,
                    action, ...(action === "import-config" ? { configPart } : {}), fingerprints: hashes, displayName: displayName.trim(), saveId: status.activeSave?.saveId ?? null };
                if (next.action !== action || action === "import-config" && (next.configPart ?? "combined") !== configPart || JSON.stringify(next.fingerprints) !== JSON.stringify(hashes)
                    || action === "import-save" && next.displayName !== displayName.trim()) throw new Error(t("transfers.retryRequiresTheSameFilesAndCampaignNameAsThe"));
                if (!remember(next)) return;
                setResult(null); setDownloadLink(null); setFeedback(null);
                let response = await submitManagedServerFile(transferForm(next), userId);
                if (!response.ok && response.stale && action === "export-save" && previous === null) {
                    // Export never changes the server, so a stale page is refreshed and the export retried once.
                    // The stale rejection is definitive, so the retry safely uses a new request identity.
                    remember(null);
                    const fresh = await readManagedServerFileStatus(serverId, userId).catch(() => null);
                    router.refresh();
                    const activeSave = fresh?.ok ? fresh.status.activeSave : null;
                    if (fresh?.ok && activeSave && next.saveId !== null && activeSave.saveId !== next.saveId) {
                        // Never silently export a different campaign than the one the owner chose.
                        response = { ...response, message: t("transfers.yourActiveCampaignChangedWhileThisPageWasOpenCheckIt") };
                    } else if (fresh?.ok && activeSave) {
                        const retry: Intent = { ...next, requestId: crypto.randomUUID(), expectedUpdatedAt: fresh.status.updatedAt, saveId: activeSave.saveId };
                        if (!remember(retry)) return;
                        response = await submitManagedServerFile(transferForm(retry), userId);
                        if (!response.ok && response.stale) response = { ...response, message: t("transfers.theServerIsStillChangingWaitAMomentAndTryExportSaveAgain") };
                    }
                }
                setDialogKind(null);
                if (response.ok) {
                    accept(response.result);
                    if (response.result.kind === "job" && !["succeeded", "failed", "cancelled"].includes(response.result.state)) setDeadline(Date.now() + 60_000);
                } else {
                    say(response.notSubmitted && previous ? t("transfers.thisAttemptWasNotSentYourPreviousRequestIsStill") : response.message, scope);
                    setDeadline(null);
                    // A local retry failure cannot rule out acceptance of the earlier attempt.
                    if (response.rejected || response.notSubmitted && !previous) { remember(null); router.refresh(); }
                }
            } catch (error) {
                const text = error instanceof Error ? error.message : t("transfers.theTransferCouldNotBeSubmitted");
                if (dialogKind) setDialogError(text); else say(text, scope);
            } finally { submitting.current = false; }
        });
    }

    // Reads the retained transfer outcome without creating a new request.
    function checkStatus() {
        if (!intent) return;
        const scope = transferScope(intent.action);
        startTransition(async () => {
            const response = await checkManagedServerFile(serverId, intent.requestId, userId).catch(() => ({ ok: false as const, message: t("transfers.connectionInterruptedYourTransferRequestIsRetained") }));
            if (intentRef.current?.requestId !== intent.requestId) return;
            if (response.ok) {
                accept(response.result);
                if (response.result?.kind === "job" && !["succeeded", "failed", "cancelled"].includes(response.result.state)) setDeadline(Date.now() + 60_000);
            } else say(response.message, scope);
        });
    }

    // Downloads the finished export, naming the file after this server.
    function downloadExport() {
        if (!intent || downloading) return;
        const requestId = intent.requestId;
        setDownloading(true);
        startTransition(async () => {
            try {
                const response = await downloadManagedServerSave(serverId, requestId, userId).catch(() => ({ ok: false as const, message: t("transfers.downloadFailedYourExportIsRetainedTryDownloadingAgain") }));
                if (!response.ok) { say(response.message, "save"); return; }
                if (response.download.kind === "link") setDownloadLink(response.download);
                else saveDownload(Uint8Array.from(atob(response.download.base64), (char) => char.charCodeAt(0)), saveExportFileName(serverName, response.download.fileName));
            } finally { setDownloading(false); }
        });
    }

    // Exports the current configuration as a ZIP of the two native files.
    function exportConfig() {
        startTransition(async () => {
            const response = await exportManagedServerConfig(serverId, userId).catch(() => ({ ok: false as const, message: t("transfers.configurationDownloadFailedPleaseTryAgain") }));
            if (response.ok) {
                try {
                    const archive = zipSync({
                        "server-config.json": strToU8(JSON.stringify(response.managedConfig.serverConfig, null, 2) + "\n"),
                        "mod-config.json": strToU8(JSON.stringify(response.managedConfig.modConfig, null, 2) + "\n"),
                    }, { level: 0 });
                    saveDownload(new Uint8Array(archive), "BannerlordCoop-configuration.zip");
                    say(t("transfers.configurationZipDownloadedOpenYourDownloadsFolderRightClickBannerlordcoop"), "config");
                } catch { say(t("transfers.configurationDownloadFailedPleaseTryAgain"), "config"); }
            }
            else say(response.message, "config");
        });
    }

    // Repeats the retained request with the same identity and inputs.
    function retrySameRequest() {
        if (!intent) return;
        if (intent.action === "export-save") submit("export-save");
        else openImport(intent.action);
    }

    // Clears a finished transfer and everything it was still showing.
    function dismiss() {
        remember(null); setResult(null); setDownloadLink(null); setFeedback(null);
    }

    const intentScope = intent ? transferScope(intent.action) : null;
    // Shows a card's transfer feedback and follow-up actions beside the controls that started them.
    function transferFeedback(scope: Scope) {
        return <>
            {intent !== null && ready && intentScope !== scope && <p className="mt-3 text-xs leading-5 text-foreground-muted">{t("transfers.pausedWhileAnotherTransferIsOpenFinishOrDismissIt")}</p>}
            <div aria-live="polite">
                {feedback?.scope === scope && <p className="mt-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-sm text-foreground-muted">{isPending && <LoaderCircle aria-hidden className="mr-2 inline size-4 animate-spin" />}{feedback.text}</p>}
            </div>
            {intent && intentScope === scope && <div className="mt-3 flex flex-wrap gap-3">
                <button className={buttonClass} disabled={isPending} onClick={checkStatus}>{t("transfers.checkStatus")}</button>
                {result === null && <button className={buttonClass} disabled={isPending} onClick={retrySameRequest}>{t("transfers.retrySameRequest")}</button>}
                {result?.kind === "job" && result.state === "succeeded" && result.action === "export-save" && <button className={buttonClass} disabled={isPending} aria-busy={downloading || undefined} onClick={downloadExport}>
                    {downloading ? <><LoaderCircle aria-hidden className="size-4 animate-spin" />{t("transfers.preparingDownload")}</> : <><Download aria-hidden className="size-4" />{t("transfers.downloadSaveExport")}</>}
                </button>}
                {result?.kind === "job" && ["succeeded", "failed", "cancelled"].includes(result.state) && <button className={buttonClass} disabled={isPending} onClick={dismiss}>{t("transfers.dismissCompletedTransfer")}</button>}
            </div>}
            {scope === "save" && downloadLink && <a className={`${buttonClass} mt-3`} href={downloadLink.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("transfers.openPrivateDownload")}</a>}
        </>;
    }

    return <div>
        {status === null && <p role="alert" className="mb-3 text-sm text-foreground-muted">{t("transfers.fileTransfersCouldNotBeLoadedRefreshThePageTo")}</p>}
        {storageError && <p role="alert" className="mb-3 text-sm text-red-200">{t("transfers.pendingTransfersCouldNotBeSavedOrRecoveredInThis")}</p>}
        <ServerSaveConfigPanels
            saveName={status ? status.activeSave?.displayName ?? t("transfers.noActiveCampaignSave") : undefined}
            configuration={status?.managedConfig}
            configAccess={canEditConfig ? { serverId, userId, canEdit: true } : undefined}
            saveActions={<>
                <button className={buttonClass} disabled={blocked || !canExportSave || !status?.activeSave || !["running", "stopped", "awaiting-save"].includes(status.operationState)} onClick={() => submit("export-save")}><Download aria-hidden className="size-4" />{t("transfers.exportSave")}</button>
                <button className={buttonClass} disabled={blocked || !canTransferSave} onClick={() => openImport("import-save")}><Upload aria-hidden className="size-4" />{t("transfers.importSave")}</button>
            </>}
            saveNotice={<>
                <p className="mt-3 text-xs leading-5 text-foreground-muted">{t("transfers.onlyTheServerOwnerCanExportSavesExportDownloadsThe")}</p>
                {transferFeedback("save")}
            </>}
            configActions={<>
                <button className={buttonClass} disabled={blocked || !canImportConfig} onClick={() => openImport("import-config")}><Upload aria-hidden className="size-4" />{t("transfers.importConfig")}</button>
                <button className={buttonClass} disabled={blocked} onClick={exportConfig}><Download aria-hidden className="size-4" />{t("transfers.exportConfig")}</button>
            </>}
            configStatus={transferFeedback("config")}
            configNotice={<>
                <p className="mt-3 text-xs leading-5 text-foreground-muted">{t("transfers.exportDownloadsAZipContainingServerConfigJsonAndMod")}</p>
                {!canImportConfig && <p className="mt-2 text-xs leading-5 text-foreground-muted">{t("transfers.onlyTheServerOwnerCanImportOrEditConfigurationSettings")}</p>}
            </>}
        />
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-foreground-muted"><Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />{t("transfers.reviewEachImportBeforeConfirmingAnyChanges")}</p>
        <dialog ref={dialogRef} onCancel={(event) => { if (isPending) event.preventDefault(); else setDialogKind(null); }} aria-labelledby="file-import-title"
            className="fixed inset-0 m-auto max-h-[90svh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto border border-gold/30 bg-surface-raised p-5 text-foreground shadow-2xl backdrop:bg-black/70 sm:p-6">
            <div className="flex items-start justify-between gap-4">
                <div><p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">{review ? t("transfers.fileImportReview") : t("transfers.fileImportSelection")}</p>
                    <h2 id="file-import-title" className="mt-2 font-display text-3xl font-semibold">{dialogKind === "import-save" ? t("transfers.importCampaignSave") : t("transfers.importConfiguration")}</h2></div>
                <button aria-label={t("transfers.closeImport")} disabled={isPending} className="p-1 text-foreground-muted focus-visible:outline-gold" onClick={() => setDialogKind(null)}><X aria-hidden className="size-5" /></button>
            </div>
            {review === null ? <div className="mt-5 space-y-4">
                <p className="text-sm leading-6 text-foreground-muted">{dialogKind === "import-save" ? t("transfers.chooseADownloadedSaveExportZipOrASavFileAndIts") : t("transfers.importOneFileAtATimeYouDoNotNeed")}</p>
                {dialogKind === "import-config" && <>
                    <label className="block text-sm font-semibold">{t("transfers.1WhichFileAreYouImporting")}{configPart === "combined" ? <span className="mt-2 block font-normal">{t("transfers.recoveringAnEarlierImportOfBothSettingsFiles")}</span> : <select className={inputClass} value={configPart} disabled={intent !== null} onChange={(event) => { setConfigPart(event.target.value as ConfigurationPart); setFiles([]); setDialogError(""); }}>
                            <option value="server">{t("transfers.serverConfigJsonServerSettings")}</option>
                            <option value="mod">{t("transfers.modConfigJsonGameplaySettings")}</option>
                        </select>}
                    </label>
                    <div className="border border-white/10 p-4 text-sm leading-6 text-foreground-muted">
                        <p className="font-semibold text-foreground">{configPart === "server" ? t("transfers.serverSettingsHowOftenYourGameSavesServerLogsAnd") : configPart === "mod" ? t("transfers.gameplaySettingsDifficultyPausingAndOtherCoOpGameRules") : t("transfers.bothSetsOfSettingsFromABackupDownloadedWithExport")}</p>
                        <p className="mt-3 font-semibold text-foreground">{t("transfers.2FindYourFile")}</p>
                        {configPart === "combined" ? <p>{t("transfers.reSelectTheSameJsonFileToRecoverYourEarlier")}</p> : <>
                            <p className="mb-3">{t("transfers.ifYouUsedExportConfigOnThisWebsiteOpenDownloads")}</p>
                            <p>{t("transfers.gameFileLocation", { path: `Documents → Mount and Blade II Bannerlord → CoopData${configPart === "server" ? " → DedicatedServer" : ""}` })}</p>
                            <p className="mt-2">{rich("transfers.chooseFileHelp", { file: <strong className="text-foreground">{configPart === "server" ? "server-config.json" : "mod-config.json"}</strong> })}</p>
                        </>}
                        <p className="mt-3">{configPart === "server" ? t("transfers.yourGameplaySettingsWillBeKeptPasswordConnectionDetailsAnd") : configPart === "mod" ? t("transfers.yourServerSettingsWillBeKept") : t("transfers.thisOptionCanChangeBothServerAndGameplaySettings")} {" "}{t("transfers.anySettingsMissingFromAnIndividualFileWillBeKept")}</p>
                    </div>
                </>}
                {dialogKind === "import-save" && <label className="block text-sm">{t("transfers.campaignName")}<input className={inputClass} maxLength={48} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
                <label className="block text-sm">{dialogKind === "import-save" ? t("transfers.saveAndCompanionFiles") : t("transfers.3ChooseYourFile")}<input className={`${inputClass} file:mr-3 file:border-0 file:bg-gold/10 file:px-3 file:py-2 file:text-gold`} key={dialogKind === "import-config" ? configPart : "save"} type="file" accept={dialogKind === "import-save" ? ".sav,.json,.zip,.blcexport" : ".json"} multiple={dialogKind === "import-save"} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
            </div> : <div className="mt-5">
                {dialogKind === "import-config" && <p className="mb-3 text-sm font-semibold">{configPart === "server" ? t("transfers.importingServerSettingsOnly") : configPart === "mod" ? t("transfers.importingGameplaySettingsOnly") : t("transfers.importingBothSetsOfSettings")}</p>}
                <p className="break-words text-sm text-foreground-muted">{files.map((file) => file.name).join(" + ")}</p>
                {dialogKind === "import-config" && <p className="mt-3 text-sm">{t("transfers.theseAreTheChangesThatWillBeMade")}</p>}
                <ul className="mt-4 max-h-60 space-y-2 overflow-y-auto border border-white/10 p-4 text-sm leading-6">{review.map((change) => <li key={change} className="break-words">{change}</li>)}</ul>
                {ignoredSettings.length > 0 && <div className="mt-4 border border-gold/30 bg-gold/5 p-3 text-sm leading-6"><p className="font-semibold">{t("transfers.theseSettingsWillNotBeImported")}</p><p>{t("transfers.ignoredSettings", { settings: new Intl.ListFormat(locale).format(ignoredSettings.map(value => settingLabel(value, t))) })}</p></div>}
                {dialogKind === "import-config" && <p className="mt-4 text-sm font-semibold">{configPart === "server" ? t("transfers.yourGameplaySettingsWillStayTheSame") : configPart === "mod" ? t("transfers.yourServerSettingsWillStayTheSame") : t("transfers.bothSetsOfSettingsCanChange")}</p>}
                <p className="mt-4 text-sm text-foreground-muted">{dialogKind === "import-config" ? t("transfers.yourSavedGameStaysTheSameAfterImportingStopAnd") : t("transfers.theServerStaysStoppedAndYourCurrentCampaignStaysSelected")}</p>
            </div>}
            {dialogError && <p role="alert" className="mt-4 text-sm text-red-200">{dialogError}</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-white/10 pt-4">
                <button className={buttonClass} disabled={isPending} onClick={() => { if (review) { setReview(null); setFiles([]); setIgnoredSettings([]); } else setDialogKind(null); }}>{review ? t("transfers.back") : t("transfers.cancel")}</button>
                <button className={buttonClass} disabled={isPending} onClick={() => {
                    if (review && dialogKind) submit(dialogKind);
                    else startTransition(async () => { try { setReview(await validateFiles()); setReviewUpdatedAt(status?.updatedAt ?? null); setDialogError(""); } catch (error) { setDialogError(error instanceof Error ? error.message : t("transfers.invalidFile")); } });
                }}>{isPending ? t("transfers.pleaseWait") : review ? dialogKind === "import-config" ? t("transfers.importTheseSettings") : t("transfers.confirmImport") : t("transfers.reviewImport")}</button>
            </div>
        </dialog>
    </div>;
}

// Resolves an approved configuration review label from its canonical key.
function settingLabel(value: string, t: Translator["t"]) {
    return t(`configuration.reviewField.${value}`);
}
// Formats validated setting values without altering import payloads.
function settingValue(value: unknown, t: Translator["t"], number: Translator["number"]) {
    return typeof value === "boolean" ? value ? t("transfers.on") : t("transfers.off") : typeof value === "string" ? t(`configuration.reviewOption.${value}`) : typeof value === "number" ? number(value) : String(value);
}
