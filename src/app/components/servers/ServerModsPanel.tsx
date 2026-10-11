"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { Lock, Menu, Trash2, Upload } from "lucide-react";

import { addServerMod, findModuleFolderManifest, moveServerMod, parseSubModuleManifest, removeServerMod, toggleServerMod, type ServerMod } from "@/app/lib/hosting/server-mods";
import { fileButtonClass } from "./ServerSaveConfigPanels";

const iconButtonClass = "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold";
const badgeClass = "shrink-0 rounded-sm border border-white/10 px-2 py-0.5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted";

// Edits a server's mod list (order, enabled flags, uploads, deletes) in local state until mod persistence exists.
export function ServerModsPanel({ initialMods, canEdit }: { initialMods: ServerMod[]; canEdit: boolean }) {
    const idPrefix = useId();
    const listRef = useRef<HTMLOListElement>(null);
    const uploadRef = useRef<HTMLInputElement>(null);
    const pendingFocusId = useRef<string | null>(null);
    const [mods, setMods] = useState(initialMods);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        const id = pendingFocusId.current;
        if (id === null) return;
        pendingFocusId.current = null;
        [...listRef.current?.querySelectorAll<HTMLButtonElement>("[data-mod-handle]") ?? []].find(handle => handle.dataset.modHandle === id)?.focus();
    }, [mods]);

    // Moves a mod and announces its new position for screen readers.
    function move(fromIndex: number, toIndex: number) {
        const next = moveServerMod(mods, fromIndex, toIndex);
        const moved = mods[fromIndex];
        const position = next.indexOf(moved);
        if (position === fromIndex) return;
        setMods(next);
        setAnnouncement(`Moved ${moved.name} to position ${position + 1} of ${next.length}.`);
    }

    // Starts dragging from the handle, using the whole row as the drag preview.
    function startDrag(event: DragEvent<HTMLButtonElement>, mod: ServerMod) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", mod.id);
        const row = event.currentTarget.closest("li");
        if (row) event.dataTransfer.setDragImage(row, 24, 24);
        setDraggingId(mod.id);
    }

    // Reorders live while the dragged mod passes over another row.
    function dragOver(event: DragEvent<HTMLLIElement>, index: number) {
        if (draggingId === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const fromIndex = mods.findIndex(mod => mod.id === draggingId);
        if (fromIndex === index) return;
        move(fromIndex, index);
    }

    // Moves the focused mod one step with the arrow keys as a drag alternative.
    function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        if (step === 0) return;
        event.preventDefault();
        pendingFocusId.current = mods[index].id;
        move(index, index + step);
    }

    // Adds the picked module folder as a disabled mod once its top-level SubModule.xml validates.
    async function upload(event: ChangeEvent<HTMLInputElement>) {
        const files = [...event.currentTarget.files ?? []];
        event.currentTarget.value = "";
        if (files.length === 0) return;
        const manifestFile = findModuleFolderManifest(files);
        if (!manifestFile) { setNotice("Choose a single module folder, such as Bannerlord.ButterLib, with SubModule.xml at its top level."); return; }
        const mod = parseSubModuleManifest(await manifestFile.text());
        if (!mod) { setNotice(`${manifestFile.webkitRelativePath} has no module Id.`); return; }
        const next = addServerMod(mods, mod);
        if (!next) { setNotice(`${mod.name} (${mod.id}) is already in the list.`); return; }
        setMods(next);
        setNotice(`Added ${mod.name} (disabled).`);
    }

    // Deletes a mod from the list after the user confirms.
    function remove(mod: ServerMod) {
        if (!window.confirm(`Delete ${mod.name} from this server's mod list?`)) return;
        setMods(current => removeServerMod(current, mod.id));
        setNotice(`Deleted ${mod.name}.`);
    }

    return <section aria-labelledby="server-mods-heading" className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <div>
                <h2 id="server-mods-heading" className="text-base font-semibold">Mods</h2>
                <p className="mt-1 text-sm leading-6 text-foreground-muted">{canEdit ? "Drag the handle to set load order. Mods load from top to bottom." : "Load order is read-only for your access level."}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <input ref={input => { uploadRef.current = input; if (input) input.webkitdirectory = true; }} type="file" hidden aria-label="Mod folder" onChange={upload} />
                <button type="button" disabled={!canEdit} onClick={() => uploadRef.current?.click()} className={fileButtonClass}><Upload className="size-4" aria-hidden="true" />Upload mod folder</button>
            </div>
            {notice && <p aria-live="polite" className="w-full text-sm text-foreground-muted">{notice}</p>}
        </div>
        <ol ref={listRef} aria-label="Mod load order" className="divide-y divide-white/10">
            {mods.map((mod, index) => {
                const checkboxId = `${idPrefix}-mod-${index}`;
                const movable = canEdit && !mod.pinned;
                const editable = canEdit && !mod.required;
                return <li key={mod.id} onDragOver={event => dragOver(event, index)} onDrop={event => event.preventDefault()} className={`flex items-center gap-3 px-3 py-3 sm:px-5 ${draggingId === mod.id ? "bg-gold/10 opacity-60" : ""}`}>
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-foreground-muted">{index + 1}</span>
                    {movable
                        ? <button type="button" draggable data-mod-handle={mod.id} aria-label={`Reorder ${mod.name}`} aria-describedby={`${idPrefix}-reorder-help`} onDragStart={event => startDrag(event, mod)} onDragEnd={() => setDraggingId(null)} onKeyDown={event => handleKey(event, index)} className={`${iconButtonClass} cursor-grab active:cursor-grabbing`}><Menu className="size-4" aria-hidden="true" /></button>
                        : <span className="inline-flex size-10 shrink-0 items-center justify-center text-foreground-muted/50" title={mod.pinned ? "Core module" : undefined}>{mod.pinned && <Lock className="size-4" aria-label="Core module, position locked" />}</span>}
                    <label htmlFor={checkboxId} title={mod.id} className={`min-w-0 flex-1 truncate text-sm ${editable ? "cursor-pointer" : ""}`}>
                        <span className={`font-medium ${mod.enabled ? "text-foreground" : "text-foreground-muted"}`}>{mod.name}</span>
                        <span className="text-foreground-muted"> · {mod.version}</span>
                    </label>
                    {mod.pinned ? <span className={badgeClass}>Core</span> : mod.required && <span className={badgeClass}>Required</span>}
                    <ModSwitch id={checkboxId} checked={mod.enabled} disabled={!editable} onChange={() => setMods(current => toggleServerMod(current, mod.id))} />
                    {editable
                        ? <button type="button" aria-label={`Delete ${mod.name}`} onClick={() => remove(mod)} className={`${iconButtonClass} hover:!text-red-300`}><Trash2 className="size-4" aria-hidden="true" /></button>
                        : <span className="size-10 shrink-0" aria-hidden="true" />}
                </li>;
            })}
        </ol>
        <p id={`${idPrefix}-reorder-help`} className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-foreground-muted">Core modules stay enabled and load first. Required mods can be reordered but stay enabled. Upload one module folder (for example Bannerlord.ButterLib) with SubModule.xml at its top level; it is added disabled. Keyboard: focus a handle and use the up and down arrow keys. Changes are not saved yet; mod persistence is not connected.</p>
        <p role="status" className="sr-only">{announcement}</p>
    </section>;
}

// Renders a native checkbox as the site's gold toggle switch, keeping checkbox semantics and label clicks.
function ModSwitch({ id, checked, disabled, onChange }: { id: string; checked: boolean; disabled: boolean; onChange: () => void }) {
    return <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
        <span aria-hidden="true" className={`pointer-events-none relative h-6 w-11 rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gold peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface peer-disabled:opacity-50 ${checked ? "border-gold bg-gold/80" : "border-white/20 bg-background"}`}>
            <span className={`absolute top-0.5 left-0 size-4 rounded-full bg-foreground shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-0.5"}`} />
        </span>
    </span>;
}

