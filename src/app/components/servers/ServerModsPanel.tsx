"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { FlaskConical, Lock, Menu, RefreshCw, Trash2, Upload } from "lucide-react";

import { useTranslations } from "@/app/lib/localization/client";
import { buildModArchive, ModArchiveError } from "@/app/lib/hosting/server-mod-archive";
import {
    enabledOwnerModCount, findServerMod, isOwnerMod, moveServerMod, sameServerModOrder, serverModLoadOrder, ServerModsError, toggleServerMod,
    type ServerMod, type ServerModArchive, type ServerModCatalog, type ServerModsState, type ServerModUploadProgress,
} from "@/app/lib/hosting/server-mods";
import { createBrowserServerModCatalog } from "@/app/lib/hosting/server-mods-transport";
import { MOD_MAXIMUM_ENABLED_OWNER_MODS } from "../../../../supabase/functions/_shared/server-mods-contract";
import { useServerWorkspaceSectionShown } from "./ServerManagementWorkspace";
import { archiveProblemMessage, describeModIssue, modsErrorMessage } from "./server-mods-messages";
import { fileButtonClass } from "./server-file-styles";

const iconButtonClass = "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const badgeClass = "shrink-0 rounded-sm border border-white/10 px-2 py-0.5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted";

/** The owner declined to replace an installed mod; nothing was sent. */
const CANCELLED = "cancelled";
/** Keyboard moves wait this long after the last arrow key so a run of steps saves once. */
const KEYBOARD_SAVE_DELAY_MS = 600;
/** Refusals that leave the saved list unchanged, so the panel can show it again without a reload. */
const PLAIN_REFUSALS = ["mod_order_invalid", "mod_dependency_unsatisfied", "mod_reserved_id", "upload_busy", "unauthenticated", "server_not_found", "runner_unsupported"];

type Busy = null | "loading" | "deleting" | "preparing" | "uploading";
type Notice = { tone: "info" | "error"; text: string };

/** The managed page's Mods tab: owners and managers load the list when the tab first opens; others see why they cannot. */
export function ManagedServerMods({ serverId, canManage }: { serverId: string; canManage: boolean }) {
    const shown = useServerWorkspaceSectionShown("Mods");
    const [catalog] = useState<ServerModCatalog>(() => createBrowserServerModCatalog());
    return <ServerModsPanel serverId={serverId} catalog={catalog} canEdit={canManage} active={shown} />;
}

/** Lists a server's mods and saves each load-order or enabled change as it is made; uploads and deletes use the same catalog. */
export function ServerModsPanel({ serverId, catalog, canEdit, active = true }: { serverId: string; catalog: ServerModCatalog; canEdit: boolean; active?: boolean }) {
    const { t } = useTranslations("managed-server");
    const idPrefix = useId();
    const listRef = useRef<HTMLOListElement>(null);
    const uploadRef = useRef<HTMLInputElement>(null);
    const pendingFocusId = useRef<string | null>(null);
    const requested = useRef(false);
    const loadedRef = useRef<ServerModsState | null>(null);
    const draftRef = useRef<ServerMod[]>([]);
    const savingRef = useRef(false);
    const draggingRef = useRef(false);
    const keyboardSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [loaded, setLoaded] = useState<ServerModsState | null>(null);
    const [draft, setDraft] = useState<ServerMod[]>([]);
    const [busy, setBusy] = useState<Busy>(null);
    const [saving, setSaving] = useState(false);
    const [loadFailed, setLoadFailed] = useState<string | null>(null);
    const [progress, setProgress] = useState<ServerModUploadProgress | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const [notice, setNotice] = useState<Notice | null>(null);

    useEffect(() => () => { if (keyboardSaveTimer.current !== null) clearTimeout(keyboardSaveTimer.current); }, []);

    useEffect(() => {
        const id = pendingFocusId.current;
        if (id === null) return;
        pendingFocusId.current = null;
        [...listRef.current?.querySelectorAll<HTMLButtonElement>("[data-mod-handle]") ?? []].find(handle => handle.dataset.modHandle === id)?.focus();
    }, [draft]);

    /** Shows a list and keeps it readable by saves that finish later. */
    function updateDraft(next: ServerMod[]) {
        draftRef.current = next;
        setDraft(next);
    }

    /** Records a confirmed state without touching the shown list. */
    function recordConfirmed(state: ServerModsState) {
        loadedRef.current = state;
        setLoaded(state);
    }

    /** Replaces the list and any edits not yet saved with a confirmed state, clearing an earlier load failure and any drag. */
    function apply(state: ServerModsState) {
        recordConfirmed(state);
        updateDraft(state.mods);
        setLoadFailed(null);
        draggingRef.current = false;
        setDraggingId(null);
    }

    /** Whether the owner is mid-way through a drag or an arrow-key run, whose end saves the final order. */
    function editingOrder() {
        return draggingRef.current || keyboardSaveTimer.current !== null;
    }

    /** Reads the list; a failure shows the last confirmed list (if any) again and offers a retry. */
    async function load() {
        setBusy("loading");
        try {
            apply(await catalog.listServerMods(serverId));
        } catch (error) {
            setLoadFailed(error instanceof ServerModsError ? modsErrorMessage(error, t) : t("mods.error.other"));
            if (loadedRef.current) updateDraft(loadedRef.current.mods);
        } finally {
            setBusy(null);
        }
    }

    useEffect(() => {
        if (!active || !canEdit || requested.current) return;
        requested.current = true;
        void load();
        // Loads once, when the tab is first shown; later loads follow edits or the Refresh button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, canEdit]);

    /** Runs one upload or delete; refusals that leave the list uncertain or stale reload it so the owner sees the truth. */
    async function change(kind: Exclude<Busy, null | "loading">, run: () => Promise<ServerModsState>, success: (state: ServerModsState) => string) {
        setBusy(kind);
        setNotice(null);
        try {
            const state = await run();
            apply(state);
            setNotice({ tone: "info", text: success(state) });
        } catch (error) {
            if (error instanceof ServerModsError && error.code === CANCELLED) return;
            const message = error instanceof ServerModsError ? modsErrorMessage(error, t) : error instanceof ModArchiveError ? archiveProblemMessage(error, t) : t("mods.error.other");
            setNotice({ tone: "error", text: message });
            if (!(error instanceof ModArchiveError)) await reconcile(error);
        } finally {
            setBusy(null);
            setProgress(null);
        }
    }

    /** Shows the saved list again after a failure: plain refusals reuse it, stale edits and unknown outcomes reload it. */
    async function reconcile(error: unknown) {
        const unchanged = error instanceof ServerModsError && !error.retryable && PLAIN_REFUSALS.includes(error.code);
        if (unchanged && loadedRef.current) {
            updateDraft(loadedRef.current.mods);
            return;
        }
        await load();
    }

    /** Saves the shown order and enabled flags, then again for edits made mid-save; only one save runs at a time. */
    async function persist() {
        if (savingRef.current || editingOrder() || !loadedRef.current || sameServerModOrder(draftRef.current, loadedRef.current.mods)) return;
        savingRef.current = true;
        setSaving(true);
        setNotice(null);
        try {
            // An unfinished drag or arrow-key run is left to the save its end starts.
            for (let base = loadedRef.current; base && !editingOrder() && !sameServerModOrder(draftRef.current, base.mods); base = loadedRef.current) {
                const sent = draftRef.current;
                const state = await catalog.saveServerModOrder(serverId, base.revision, serverModLoadOrder(sent));
                recordConfirmed(state);
                if (draftRef.current === sent) updateDraft(state.mods);
            }
            setNotice({ tone: "info", text: t("mods.saved") });
        } catch (error) {
            setNotice({ tone: "error", text: error instanceof ServerModsError ? modsErrorMessage(error, t) : t("mods.error.other") });
            await reconcile(error);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    /** Saves once the owner pauses between arrow-key moves. */
    function persistSoon() {
        if (keyboardSaveTimer.current !== null) clearTimeout(keyboardSaveTimer.current);
        keyboardSaveTimer.current = setTimeout(() => {
            keyboardSaveTimer.current = null;
            void persist();
        }, KEYBOARD_SAVE_DELAY_MS);
    }

    /** Moves a mod in the draft and announces its new position for screen readers; returns whether it moved. */
    function move(fromIndex: number, toIndex: number): boolean {
        const next = moveServerMod(draft, fromIndex, toIndex);
        const moved = draft[fromIndex];
        const position = next.indexOf(moved);
        if (position === fromIndex) return false;
        updateDraft(next);
        setAnnouncement(t("mods.moved", { name: moved.name, position: position + 1, total: next.length }));
        return true;
    }

    /** Starts dragging from the handle, using the whole row as the drag preview. */
    function startDrag(event: DragEvent<HTMLButtonElement>, mod: ServerMod) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", mod.id);
        const row = event.currentTarget.closest("li");
        if (row) event.dataTransfer.setDragImage(row, 24, 24);
        draggingRef.current = true;
        setDraggingId(mod.id);
    }

    /** Reorders live while the dragged mod passes over another row. */
    function dragOver(event: DragEvent<HTMLLIElement>, index: number) {
        if (draggingId === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const fromIndex = draft.findIndex(mod => mod.id === draggingId);
        if (fromIndex === index) return;
        move(fromIndex, index);
    }

    /** Moves the focused mod one step with the arrow keys as a drag alternative. */
    function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const id = draft[index].id;
        if (!move(index, index + step)) return;
        pendingFocusId.current = id;
        persistSoon();
    }

    /** Ends a drag and saves wherever the mod was left. */
    function endDrag() {
        draggingRef.current = false;
        setDraggingId(null);
        void persist();
    }

    /** Flips an owner mod and saves it, refusing to enable more than the control plane allows. */
    function toggle(mod: ServerMod) {
        if (!mod.enabled && enabledOwnerModCount(draftRef.current) >= MOD_MAXIMUM_ENABLED_OWNER_MODS) {
            setNotice({ tone: "error", text: t("mods.enabledLimit", { limit: MOD_MAXIMUM_ENABLED_OWNER_MODS }) });
            return;
        }
        updateDraft(toggleServerMod(draftRef.current, mod.id));
        void persist();
    }

    /** Deletes an owner mod after the owner confirms. */
    function remove(mod: ServerMod) {
        if (!loaded || !window.confirm(t("mods.confirmDelete", { name: mod.name }))) return;
        void change("deleting", () => catalog.deleteServerMod(serverId, loaded.revision, mod.id), () => t("mods.deleted", { name: mod.name }));
    }

    /** Zips the picked module folder, confirms a replacement, uploads it and reports where it was installed. */
    async function upload(event: ChangeEvent<HTMLInputElement>) {
        const files = [...event.currentTarget.files ?? []];
        event.currentTarget.value = "";
        if (files.length === 0 || !loaded) return;
        const revision = loaded.revision;
        const picked: { archive?: ServerModArchive; replaced?: boolean } = {};
        await change("preparing", async () => {
            // Let the browser paint the preparing state between file reads and before compressing.
            const archive = picked.archive = await buildModArchive(files, { yieldToBrowser: () => new Promise(resolve => setTimeout(resolve, 0)) });
            const existing = findServerMod(loaded.mods, archive.manifest.id);
            picked.replaced = existing !== undefined;
            if (existing && !window.confirm(t("mods.confirmReplace", { name: existing.name, current: existing.version, version: archive.manifest.version }))) {
                throw new ServerModsError(CANCELLED);
            }
            setBusy("uploading");
            return catalog.uploadServerMod(serverId, revision, archive, setProgress);
        }, state => installedMessage(state, picked.archive!, picked.replaced === true));
    }

    /** Names the installed mod, saying when it replaced a version or was left disabled by a dependency or limit rule. */
    function installedMessage(state: ServerModsState, archive: ServerModArchive, replaced: boolean) {
        const mod = findServerMod(state.mods, archive.manifest.id);
        const values = { name: mod?.name ?? archive.manifest.name, version: archive.manifest.version };
        if (replaced) return t("mods.uploadReplaced", values);
        return mod && !mod.enabled ? t("mods.uploadInstalledDisabled", values) : t("mods.uploadInstalled", values);
    }

    const busyNow = busy !== null;
    // Refresh, upload and delete wait for pending saves so they start from the list the owner sees.
    const settled = !saving && loaded !== null && sameServerModOrder(draft, loaded.mods);

    return <section aria-labelledby={`${idPrefix}-heading`} aria-busy={busyNow || saving} className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <div>
                <h2 id={`${idPrefix}-heading`} className="text-base font-semibold">{t("mods.heading")}</h2>
                {!canEdit && <p className="mt-1 text-sm leading-6 text-foreground-muted">{t("mods.readOnly")}</p>}
            </div>
            {canEdit && <div className="flex flex-wrap items-center gap-3">
                <input ref={input => { uploadRef.current = input; if (input) input.webkitdirectory = true; }} type="file" hidden aria-label={t("mods.folderInput")} onChange={upload} />
                <button type="button" disabled={busyNow || !settled} onClick={() => void load()} className={fileButtonClass}><RefreshCw className="size-4" aria-hidden="true" />{t("mods.refresh")}</button>
                <button type="button" disabled={busyNow || !settled} onClick={() => uploadRef.current?.click()} className={fileButtonClass}><Upload className="size-4" aria-hidden="true" />{t("mods.upload")}</button>
            </div>}
            <p className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground-muted"><FlaskConical className="size-4 shrink-0" aria-hidden="true" />{t("mods.experimental")}</p>
            {loaded?.restartRequired && <p role="status" className="w-full rounded-md border border-gold/30 bg-gold/[0.06] px-3 py-2 text-sm text-foreground">{t("mods.restartRequired")}</p>}
            {progress && <UploadProgress progress={progress} />}
            {busy === "preparing" && <p role="status" className="w-full text-sm text-foreground-muted">{t("mods.phase.preparing")}</p>}
            {saving && <p role="status" className="w-full text-sm text-foreground-muted">{t("mods.saving")}</p>}
            {notice && !saving && <p aria-live="polite" className={`w-full text-sm ${notice.tone === "error" ? "text-red-300" : "text-foreground-muted"}`}>{notice.text}</p>}
        </div>
        {canEdit && loaded === null && <div className="p-5 text-sm text-foreground-muted">
            {loadFailed === null ? <p role="status">{t("mods.loading")}</p> : <>
                <p role="alert">{loadFailed}</p>
                <button type="button" disabled={busyNow} onClick={() => void load()} className={`${fileButtonClass} mt-3`}>{t("mods.retry")}</button>
            </>}
        </div>}
        {loaded !== null && <>
            {loadFailed !== null && <p role="alert" className="border-b border-white/10 px-5 py-3 text-sm text-red-300">{loadFailed}</p>}
            <ol ref={listRef} aria-label={t("mods.loadOrder")} className="divide-y divide-white/10">
                {draft.map((mod, index) => <ModRow key={mod.id} mod={mod} index={index} idPrefix={idPrefix} editable={canEdit && !busyNow} canDelete={settled} dragging={draggingId === mod.id}
                    onDragStart={event => startDrag(event, mod)} onDragEnd={endDrag} onDragOver={event => dragOver(event, index)}
                    onKeyDown={event => handleKey(event, index)} onToggle={() => toggle(mod)} onDelete={() => remove(mod)} />)}
            </ol>
            <p id={`${idPrefix}-reorder-help`} className="sr-only">{t("mods.reorderHelp")}</p>
        </>}
        <p role="status" className="sr-only">{announcement}</p>
    </section>;
}

/** One load-order row: position, handle or lock, name and notes, badges, enabled switch and delete. */
function ModRow({ mod, index, idPrefix, editable, canDelete, dragging, onDragStart, onDragEnd, onDragOver, onKeyDown, onToggle, onDelete }: {
    mod: ServerMod; index: number; idPrefix: string; editable: boolean; canDelete: boolean; dragging: boolean;
    onDragStart: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void; onDragOver: (event: DragEvent<HTMLLIElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void; onToggle: () => void; onDelete: () => void;
}) {
    const { t } = useTranslations("managed-server");
    const checkboxId = `${idPrefix}-mod-${index}`;
    const movable = editable && !mod.pinned;
    const owner = isOwnerMod(mod);
    return <li onDragOver={onDragOver} onDrop={event => event.preventDefault()} className={`flex items-center gap-3 px-3 py-3 sm:px-5 ${dragging ? "bg-gold/10 opacity-60" : ""}`}>
        <span className="w-6 shrink-0 text-right font-mono text-xs text-foreground-muted">{index + 1}</span>
        {movable
            ? <button type="button" draggable data-mod-handle={mod.id} aria-label={t("mods.reorder", { name: mod.name })} aria-describedby={`${idPrefix}-reorder-help`} onDragStart={onDragStart} onDragEnd={onDragEnd} onKeyDown={onKeyDown} className={`${iconButtonClass} cursor-grab active:cursor-grabbing`}><Menu className="size-4" aria-hidden="true" /></button>
            : <span className="inline-flex size-10 shrink-0 items-center justify-center text-foreground-muted/50" title={mod.pinned ? t("mods.coreLocked") : undefined}>{mod.pinned && <Lock className="size-4" aria-label={t("mods.coreLocked")} />}</span>}
        <div className="min-w-0 flex-1">
            <label htmlFor={checkboxId} title={mod.id} className={`block truncate text-sm ${editable && owner ? "cursor-pointer" : ""}`}>
                <span className={`font-medium ${mod.enabled ? "text-foreground" : "text-foreground-muted"}`}>{mod.name}</span>
                {mod.version && <span className="text-foreground-muted"> · {mod.version}</span>}
            </label>
            {mod.issues.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-foreground-muted">{mod.issues.map(issue => <li key={issue}>{describeModIssue(issue, t)}</li>)}</ul>}
        </div>
        {mod.pinned ? <span className={badgeClass}>{t("mods.core")}</span> : mod.required && <span className={badgeClass}>{t("mods.required")}</span>}
        <ModSwitch id={checkboxId} checked={mod.enabled} disabled={!editable || !owner} onChange={onToggle} />
        {editable && owner
            ? <button type="button" disabled={!canDelete} aria-label={t("mods.delete", { name: mod.name })} onClick={onDelete} className={`${iconButtonClass} hover:!text-red-300`}><Trash2 className="size-4" aria-hidden="true" /></button>
            : <span className="size-10 shrink-0" aria-hidden="true" />}
    </li>;
}

/** Shows the current upload phase, with a percentage while chunks are sent. */
function UploadProgress({ progress }: { progress: ServerModUploadProgress }) {
    const { t } = useTranslations("managed-server");
    const percent = progress.totalBytes === 0 ? 0 : Math.floor(progress.sentBytes / progress.totalBytes * 100);
    const label = progress.phase === "uploading" ? t("mods.phase.uploading", { percent }) : t(`mods.phase.${progress.phase}`);
    return <div className="w-full" role="status">
        <p className="text-sm text-foreground-muted">{label}</p>
        {progress.phase === "uploading" && <progress className="mt-2 h-1.5 w-full accent-gold" max={100} value={percent} aria-label={label} />}
    </div>;
}

/** Renders a native checkbox as the site's gold toggle switch, keeping checkbox semantics and label clicks. */
function ModSwitch({ id, checked, disabled, onChange }: { id: string; checked: boolean; disabled: boolean; onChange: () => void }) {
    return <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
        <span aria-hidden="true" className={`pointer-events-none relative h-6 w-11 rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gold peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface peer-disabled:opacity-50 ${checked ? "border-gold bg-gold/80" : "border-white/20 bg-background"}`}>
            <span className={`absolute top-0.75 left-0 size-4 rounded-full bg-foreground shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-0.5"}`} />
        </span>
    </span>;
}
