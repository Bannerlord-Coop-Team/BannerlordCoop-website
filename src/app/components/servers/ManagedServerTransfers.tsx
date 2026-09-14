"use client";

import { ServerSaveConfigPanels, fileButtonClass } from "./ServerSaveConfigPanels";
import { strToU8, zipSync } from "fflate";
import { Download, Upload, Info, X, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkManagedServerFile, downloadManagedServerSave, exportManagedServerConfig, submitManagedServerFile } from "@/app/servers/managed-server-file-actions";
import { readConfigurationFile, applyConfigurationImport, type ConfigurationPart } from "../../../../supabase/functions/_shared/configuration-file-import";
import { MAXIMUM_WEB_SAVE_BYTES, MAXIMUM_WEB_CONFIG_BYTES, requireUuid, requireFileTimestamp, type OwnerFileStatus, type OwnerFileResult } from "../../../../supabase/functions/_shared/server-file-contract";

type Intent = {
    requestId: string; serverId: string; expectedUpdatedAt: string;
    action: "import-save" | "export-save" | "import-config";
    fingerprints: string[]; displayName: string; saveId: string | null; configPart?: ConfigurationPart;
};
const buttonClass = fileButtonClass;
const inputClass = "mt-2 block w-full min-w-0 border border-white/15 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";

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

function saveDownload(bytes: BlobPart, fileName: string) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = fileName;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ManagedServerTransfers({ userId, serverId, status, canImportConfig }: { userId: string; serverId: string; status: OwnerFileStatus | null; canImportConfig: boolean }) {
    return <TransferSession key={`${userId}:${serverId}`} userId={userId} serverId={serverId} status={status} canImportConfig={canImportConfig} />;
}

function TransferSession({ userId, serverId, status, canImportConfig }: { userId: string; serverId: string; status: OwnerFileStatus | null; canImportConfig: boolean }) {
    const router = useRouter();
    const storageKey = `managed-file-transfer:v1:${userId}:${serverId}`;
    const [ready, setReady] = useState(false);
    const [storageError, setStorageError] = useState(false);
    const [intent, setIntent] = useState<Intent | null>(null);
    const intentRef = useRef<Intent | null>(null);
    const [result, setResult] = useState<OwnerFileResult | null>(null);
    const [message, setMessage] = useState("");
    const [isPending, startTransition] = useTransition();
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
                if (stored) setMessage("A previous transfer is saved. Check its status before retrying.");
            } catch { setStorageError(true); }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [storageKey, serverId]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialogKind && dialog && !dialog.open) dialog.showModal();
        if (!dialogKind && dialog?.open) dialog.close();
    }, [dialogKind]);

    function accept(next: OwnerFileResult | null) {
        setResult(next);
        if (next === null) { setMessage("No accepted transfer was found. Retry the same request with the same files."); return; }
        if (next.kind === "rejected") {
            setMessage("The transfer was rejected before a job was accepted. Check your files or refresh the server and try again."); remember(null); setDeadline(null); router.refresh();
        } else if (next.kind === "configuration") {
            setMessage("Settings imported. If the server is running, stop it and start it again to use them. If it is stopped, start it when you are ready."); remember(null); setDeadline(null); router.refresh();
        } else if (["succeeded", "failed", "cancelled"].includes(next.state)) {
            setDeadline(null); router.refresh();
            setMessage(next.state === "succeeded" ? next.action === "export-save" ? "Your save export is ready to download." : "Campaign added. Your current campaign is unchanged."
                : `The transfer ${next.state}. Your request is retained for reference.`);
            if (next.state === "succeeded" && next.action === "import-save") remember(null);
        } else setMessage(next.action === "export-save" ? "Preparing your save export…" : "Validating and importing your campaign…");
    }

    useEffect(() => {
        if (deadline === null || intent === null) return;
        let cancelled = false;
        let timer: number;
        async function poll() {
            if (Date.now() >= deadline!) {
                setDeadline(null); setMessage("Still waiting for confirmation. Use Check status to continue."); return;
            }
            const response = await checkManagedServerFile(serverId, intent!.requestId, userId).catch(() => ({ ok: false as const, message: "Connection interrupted. Your transfer request is retained." }));
            if (cancelled || intentRef.current?.requestId !== intent!.requestId) return;
            if (response.ok) {
                accept(response.result);
                if (response.result?.kind === "rejected" || response.result?.kind === "configuration" || response.result?.kind === "job"
                    && ["succeeded", "failed", "cancelled"].includes(response.result.state)) return;
            } else setMessage(response.message);
            timer = window.setTimeout(poll, 4_000);
        }
        timer = window.setTimeout(poll, 4_000);
        return () => { cancelled = true; window.clearTimeout(timer); };
        // Poll only the recorded request; UI renders do not restart its deadline.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deadline, intent?.requestId, serverId, userId]);

    function openImport(kind: "import-save" | "import-config") {
        const input = dialogRef.current?.querySelector<HTMLInputElement>('input[type="file"]');
        if (input) input.value = "";
        setFiles([]); setDisplayName(intentRef.current?.displayName ?? "");
        setConfigPart(intentRef.current ? intentRef.current.configPart ?? "combined" : "server");
        setIgnoredSettings([]); setReview(null); setDialogError(""); setDialogKind(kind);
    }

    async function validateFiles() {
        if (dialogKind === "import-config") {
            if (files.length !== 1 || !files[0].name.endsWith(".json") || files[0].size > MAXIMUM_WEB_CONFIG_BYTES || files[0].size === 0) {
                throw new Error("Choose one configuration JSON file, up to 64 KiB.");
            }
            const importedFile = readConfigurationFile(await files[0].text(), configPart);
            setIgnoredSettings(importedFile.ignoredSettings);
            if (!status) throw new Error("Refresh the page to load your current settings.");
            const imported = applyConfigurationImport(status.managedConfig, importedFile.input);
            const changes: string[] = [];
            function compare(before: unknown, after: unknown, prefix: string) {
                if (after !== null && typeof after === "object") {
                    for (const [key, value] of Object.entries(after)) compare((before as Record<string, unknown> | undefined)?.[key], value, prefix ? `${prefix}.${key}` : key);
                } else if (before !== after) changes.push(`${prefix.split(".").at(-1)!.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/^./u, (letter) => letter.toUpperCase())}: ${settingValue(before)} → ${settingValue(after)}`);
            }
            compare(status?.managedConfig, imported, "");
            return changes.length ? changes : ["This file matches your current settings."];
        }
        if (![1, 2].includes(files.length) || files.some((file) => file.size === 0)
            || files.reduce((total, file) => total + file.size, 0) > MAXIMUM_WEB_SAVE_BYTES) throw new Error("Choose a .blcexport or a matching .sav and .json pair, up to 20 MiB total.");
        if (files.some((file) => !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,118}\.(?:sav|json|blcexport)$/u.test(file.name) || file.name.includes(".."))) throw new Error("Use filenames containing letters, numbers, spaces, underscores, hyphens and a single extension.");
        const save = files.find((file) => file.name.endsWith(".sav"));
        if (!(files.length === 1 && files[0].name.endsWith(".blcexport")) && (!save || !files.some((file) => file.name === save.name.slice(0, -4) + ".json"))) throw new Error("The .sav and .json filenames must match.");
        if (displayName.trim().length < 3 || displayName.trim().length > 48) throw new Error("Enter a campaign name between 3 and 48 characters.");
        if (/[\p{Cc}\p{Cf}]/u.test(displayName.trim())) throw new Error("The campaign name contains invisible characters. Delete the name and type it again instead of pasting it.");
        return ["This adds a separate campaign after server validation.", "Your current campaign and existing saves will not be replaced or selected differently."];
    }

    async function fingerprints() {
        return Promise.all([...files].sort((a, b) => a.name.localeCompare(b.name)).map(async (file) => {
            const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
            return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
        }));
    }

    function submit(action: Intent["action"]) {
        if (submitting.current || status === null) return;
        submitting.current = true;
        startTransition(async () => {
            try {
                if (action === "import-config" && !intentRef.current && reviewUpdatedAt !== status.updatedAt) throw new Error("The server settings changed while this screen was open. Go back and review your file again.");
                if (action !== "export-save") await validateFiles();
                const hashes = action === "export-save" ? [] : await fingerprints();
                const previous = intentRef.current;
                const next: Intent = previous ?? { requestId: crypto.randomUUID(), serverId, expectedUpdatedAt: status.updatedAt,
                    action, ...(action === "import-config" ? { configPart } : {}), fingerprints: hashes, displayName: displayName.trim(), saveId: status.activeSave?.saveId ?? null };
                if (next.action !== action || action === "import-config" && (next.configPart ?? "combined") !== configPart || JSON.stringify(next.fingerprints) !== JSON.stringify(hashes)
                    || action === "import-save" && next.displayName !== displayName.trim()) throw new Error("Retry requires the same files and campaign name as the pending request.");
                if (!remember(next)) return;
                setResult(null); setDownloadLink(null);
                const form = new FormData();
                for (const [key, value] of Object.entries(next)) if (typeof value === "string") form.set(key, value);
                if (action === "import-config") form.set("config", files[0]);
                if (action === "import-save") for (const file of files) form.append("files", file);
                const response = await submitManagedServerFile(form, userId);
                setDialogKind(null);
                if (response.ok) {
                    accept(response.result);
                    if (response.result.kind === "job" && !["succeeded", "failed", "cancelled"].includes(response.result.state)) setDeadline(Date.now() + 60_000);
                } else {
                    setMessage(response.notSubmitted && previous ? "This attempt was not sent. Your previous request is still saved. Check its status before retrying." : response.message);
                    setDeadline(null);
                    // A local retry failure cannot rule out acceptance of the earlier attempt.
                    if (response.rejected || response.notSubmitted && !previous) { remember(null); router.refresh(); }
                }
            } catch (error) {
                const text = error instanceof Error ? error.message : "The transfer could not be submitted.";
                if (dialogKind) setDialogError(text); else setMessage(text);
            } finally { submitting.current = false; }
        });
    }

    function checkStatus() {
        if (!intent) return;
        startTransition(async () => {
            const response = await checkManagedServerFile(serverId, intent.requestId, userId).catch(() => ({ ok: false as const, message: "Connection interrupted. Your transfer request is retained." }));
            if (intentRef.current?.requestId !== intent.requestId) return;
            if (response.ok) {
                accept(response.result);
                if (response.result?.kind === "job" && !["succeeded", "failed", "cancelled"].includes(response.result.state)) setDeadline(Date.now() + 60_000);
            } else setMessage(response.message);
        });
    }

    return <div>
        <ServerSaveConfigPanels
            saveName={status ? status.activeSave?.displayName ?? "No active campaign save" : undefined}
            configuration={status?.managedConfig}
            saveActions={<>
                <button className={buttonClass} disabled={blocked || !status?.activeSave || !["running", "stopped", "awaiting-save"].includes(status.operationState)} onClick={() => submit("export-save")}><Download aria-hidden className="size-4" />Export save</button>
                <button className={buttonClass} disabled={blocked || !canTransferSave} onClick={() => openImport("import-save")}><Upload aria-hidden className="size-4" />Import save</button>
            </>}
            saveNotice={<p className="mt-3 text-xs leading-5 text-foreground-muted">Export downloads the current campaign’s latest completed save, even while the server is running. Stop the server before adding an imported campaign; your current campaign will stay selected.</p>}
            configActions={<>
                <button className={buttonClass} disabled={blocked || !canImportConfig} onClick={() => openImport("import-config")}><Upload aria-hidden className="size-4" />Import config</button>
                <button className={buttonClass} disabled={blocked} onClick={() => startTransition(async () => {
                        const response = await exportManagedServerConfig(serverId, userId).catch(() => ({ ok: false as const, message: "Configuration download failed. Please try again." }));
                        if (response.ok) {
                            try {
                                const archive = zipSync({
                                    "server-config.json": strToU8(JSON.stringify(response.managedConfig.serverConfig, null, 2) + "\n"),
                                    "mod-config.json": strToU8(JSON.stringify(response.managedConfig.modConfig, null, 2) + "\n"),
                                }, { level: 0 });
                                saveDownload(new Uint8Array(archive), "BannerlordCoop-configuration.zip");
                                setMessage("Configuration ZIP downloaded. Open your Downloads folder, right-click BannerlordCoop-configuration.zip and choose Extract All (or double-click it on a Mac). Import server-config.json or mod-config.json separately; do not select the ZIP.");
                            } catch { setMessage("Configuration download failed. Please try again."); }
                        }
                        else setMessage(response.message);
                    })}><Download aria-hidden className="size-4" />Export config</button>
            </>}
            configNotice={<>
                <p className="mt-3 text-xs leading-5 text-foreground-muted">Export downloads a ZIP containing server-config.json and mod-config.json. Import either file individually. Passwords and campaign paths are excluded.</p>
                <p className="mt-2 text-xs leading-5 text-foreground-muted">{canImportConfig ? "After importing, stop and start a running server to use the new settings." : "Only the server owner can import configuration settings."}</p>
            </>}
        />
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-foreground-muted"><Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />Review each import before confirming any changes.</p>
        {status === null && <p role="alert" className="mt-3 text-sm text-foreground-muted">File transfers could not be loaded. Refresh the page to try again. Backups remain available in the Backups tab.</p>}
        {storageError && <p role="alert" className="mt-3 text-sm text-red-200">Pending transfers could not be saved or recovered in this browser. Transfers are paused to prevent duplicate requests.</p>}
        {message && <p role="status" className="mt-4 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-sm text-foreground-muted">{isPending && <LoaderCircle aria-hidden className="mr-2 inline size-4 animate-spin" />}{message}</p>}
        {intent && <div className="mt-3 flex flex-wrap gap-3">
            <button className={buttonClass} disabled={isPending} onClick={checkStatus}>Check status</button>
            {result === null && <button className={buttonClass} disabled={isPending} onClick={() => intent.action === "export-save" ? submit("export-save") : openImport(intent.action)}>Retry same request</button>}
            {result?.kind === "job" && result.state === "succeeded" && result.action === "export-save" && <button className={buttonClass} disabled={isPending} onClick={() => startTransition(async () => {
                const response = await downloadManagedServerSave(serverId, intent.requestId, userId).catch(() => ({ ok: false as const, message: "Download failed. Your export is retained; try downloading again." }));
                if (!response.ok) { setMessage(response.message); return; }
                if (response.download.kind === "link") setDownloadLink(response.download);
                else saveDownload(Uint8Array.from(atob(response.download.base64), (char) => char.charCodeAt(0)), response.download.fileName);
            })}><Download aria-hidden className="size-4" />Download save export</button>}
            {result?.kind === "job" && ["succeeded", "failed", "cancelled"].includes(result.state) && <button className={buttonClass} disabled={isPending} onClick={() => { remember(null); setResult(null); setDownloadLink(null); }}>Dismiss completed transfer</button>}
        </div>}
        {downloadLink && <a className={`${buttonClass} mt-3`} href={downloadLink.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open private download</a>}
        <dialog ref={dialogRef} onCancel={(event) => { if (isPending) event.preventDefault(); else setDialogKind(null); }} aria-labelledby="file-import-title"
            className="fixed inset-0 m-auto max-h-[90svh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto border border-gold/30 bg-surface-raised p-5 text-foreground shadow-2xl backdrop:bg-black/70 sm:p-6">
            <div className="flex items-start justify-between gap-4">
                <div><p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">File import · {review ? "Review" : "Select files"}</p>
                    <h2 id="file-import-title" className="mt-2 font-display text-3xl font-semibold">{dialogKind === "import-save" ? "Import campaign save" : "Import configuration"}</h2></div>
                <button aria-label="Close import" disabled={isPending} className="p-1 text-foreground-muted focus-visible:outline-gold" onClick={() => setDialogKind(null)}><X aria-hidden className="size-5" /></button>
            </div>
            {review === null ? <div className="mt-5 space-y-4">
                <p className="text-sm leading-6 text-foreground-muted">{dialogKind === "import-save" ? "Choose a downloaded .blcexport, or a .sav file and its matching .json companion. Maximum 20 MiB total." : "Import one file at a time. You do not need to open or edit it. Your saved game and server password will stay the same."}</p>
                {dialogKind === "import-config" && <>
                    <label className="block text-sm font-semibold">1. Which file are you importing?
                        <select className={inputClass} value={configPart} disabled={intent !== null} onChange={(event) => { setConfigPart(event.target.value as ConfigurationPart); setFiles([]); setDialogError(""); }}>
                            <option value="server">server-config.json — server settings</option>
                            <option value="mod">mod-config.json — gameplay settings</option>
                            <option value="combined">Website settings backup — both (older .json exports)</option>
                        </select>
                    </label>
                    <div className="border border-white/10 p-4 text-sm leading-6 text-foreground-muted">
                        <p className="font-semibold text-foreground">{configPart === "server" ? "Server settings: how often your game saves, server logs and Steam settings." : configPart === "mod" ? "Gameplay settings: difficulty, pausing and other co-op game rules." : "Both sets of settings from a backup downloaded with Export config on this website."}</p>
                        <p className="mt-3 font-semibold text-foreground">2. Find your file</p>
                        {configPart === "combined" ? <p>This is only for an older BannerlordCoop-configuration.json backup. For a new ZIP export, extract it first, then select server-config.json or mod-config.json above.</p> : <>
                            <p className="mb-3">If you used Export config on this website, open Downloads, right-click BannerlordCoop-configuration.zip and choose Extract All (or double-click it on a Mac). Open the extracted folder and choose the file below. Do not select the ZIP.</p>
                            <p>For a file from the game, on the computer where you played or hosted, open Documents → Mount and Blade II Bannerlord → CoopData{configPart === "server" ? " → DedicatedServer" : ""}.</p>
                            <p className="mt-2">Choose <strong className="text-foreground">{configPart === "server" ? "server-config.json" : "mod-config.json"}</strong>. If you used a custom data folder, look there instead. If you cannot find the file, cancel and ask support for help.</p>
                        </>}
                        <p className="mt-3">{configPart === "server" ? "Your gameplay settings will be kept. Password, connection details and save selection are not taken from this file." : configPart === "mod" ? "Your server settings will be kept." : "This option can change both server and gameplay settings."} Any settings missing from an individual file will be kept.</p>
                    </div>
                </>}
                {dialogKind === "import-save" && <label className="block text-sm">Campaign name<input className={inputClass} maxLength={48} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
                <label className="block text-sm">{dialogKind === "import-save" ? "Save and companion files" : "3. Choose your file"}<input className={`${inputClass} file:mr-3 file:border-0 file:bg-gold/10 file:px-3 file:py-2 file:text-gold`} key={dialogKind === "import-config" ? configPart : "save"} type="file" accept={dialogKind === "import-save" ? ".sav,.json,.blcexport" : ".json"} multiple={dialogKind === "import-save"} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
            </div> : <div className="mt-5">
                {dialogKind === "import-config" && <p className="mb-3 text-sm font-semibold">{configPart === "server" ? "Importing server settings only" : configPart === "mod" ? "Importing gameplay settings only" : "Importing both sets of settings"}</p>}
                <p className="break-words text-sm text-foreground-muted">{files.map((file) => file.name).join(" + ")}</p>
                {dialogKind === "import-config" && <p className="mt-3 text-sm">These are the changes that will be made:</p>}
                <ul className="mt-4 max-h-60 space-y-2 overflow-y-auto border border-white/10 p-4 text-sm leading-6">{review.map((change) => <li key={change} className="break-words">{change}</li>)}</ul>
                {ignoredSettings.length > 0 && <div className="mt-4 border border-gold/30 bg-gold/5 p-3 text-sm leading-6"><p className="font-semibold">These settings will not be imported:</p><p>{ignoredSettings.map(settingLabel).join(", ")}. This website manages them separately or does not support changing them.</p></div>}
                {dialogKind === "import-config" && <p className="mt-4 text-sm font-semibold">{configPart === "server" ? "Your gameplay settings will stay the same." : configPart === "mod" ? "Your server settings will stay the same." : "Both sets of settings can change."}</p>}
                <p className="mt-4 text-sm text-foreground-muted">{dialogKind === "import-config" ? "Your saved game stays the same. After importing, stop and start the server to use the new settings. If it is already stopped, just start it when you are ready." : "The server stays stopped and your current campaign stays selected. Importing does not switch campaigns."}</p>
            </div>}
            {dialogError && <p role="alert" className="mt-4 text-sm text-red-200">{dialogError}</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-white/10 pt-4">
                <button className={buttonClass} disabled={isPending} onClick={() => { if (review) { setReview(null); setFiles([]); setIgnoredSettings([]); } else setDialogKind(null); }}>{review ? "Back" : "Cancel"}</button>
                <button className={buttonClass} disabled={isPending} onClick={() => {
                    if (review && dialogKind) submit(dialogKind);
                    else startTransition(async () => { try { setReview(await validateFiles()); setReviewUpdatedAt(status?.updatedAt ?? null); setDialogError(""); } catch (error) { setDialogError(error instanceof Error ? error.message : "Invalid file"); } });
                }}>{isPending ? "Please wait…" : review ? dialogKind === "import-config" ? "Import these settings" : "Confirm import" : "Review import"}</button>
            </div>
        </dialog>
    </div>;
}

function settingLabel(value: string) {
    const labels: Record<string, string> = { saveName: "Saved game selection", password: "Server password", port: "Connection port", battleSize: "Battle size", showPlayerNameplates: "Player nameplates", playerWoundedBattleEntry: "Joining battles while wounded" };
    return labels[value] ?? value.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/^./u, (letter) => letter.toUpperCase());
}
function settingValue(value: unknown) {
    return typeof value === "boolean" ? value ? "On" : "Off" : typeof value === "string" ? settingLabel(value) : String(value);
}
