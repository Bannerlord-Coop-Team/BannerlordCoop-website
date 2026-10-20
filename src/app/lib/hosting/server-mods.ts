import type { ModEntry, ModOrderEntry, ModsState, ModUploadManifest } from "../../../../supabase/functions/_shared/server-mods-contract";

// The Mods tab's domain: installed mods as the control plane lists them, the catalog the panel depends
// on (an API-backed implementation and an in-memory mock implement it), and pure load-order edits.

/** One installed module. `pinned`: a core module with a fixed position; `required`: Coop, always enabled. */
export type ServerMod = ModEntry;
/** The installed list, its revision for stale-edit protection, and whether a restart would change the running game. */
export type ServerModsState = ModsState;
export type ServerModOrderEntry = ModOrderEntry;

/** A zipped module folder ready to upload, with the identity read from its `SubModule.xml`. */
export type ServerModArchive = { manifest: ModUploadManifest; bytes: Uint8Array<ArrayBuffer>; fileCount: number; uncompressedBytes: number };

/** Where an upload is: creating its session, sending chunks, installing on the runner, or confirming the result. */
export type ServerModUploadProgress = { phase: "creating" | "uploading" | "installing" | "verifying"; sentBytes: number; totalBytes: number };

/** The website asks its own route to refresh the Supabase session with this header, once, after a 401. */
export const MODS_REFRESH_SESSION_HEADER = "x-mods-refresh-session";

/** Supplies and changes one server's installed mods; every change is checked against the revision it was based on. */
export interface ServerModCatalog {
    listServerMods(serverId: string): Promise<ServerModsState>;
    saveServerModOrder(serverId: string, expectedRevision: string, order: ServerModOrderEntry[]): Promise<ServerModsState>;
    deleteServerMod(serverId: string, expectedRevision: string, modId: string): Promise<ServerModsState>;
    uploadServerMod(serverId: string, expectedRevision: string, archive: ServerModArchive, onProgress?: (progress: ServerModUploadProgress) => void): Promise<ServerModsState>;
}

/** A refused or unconfirmed catalog call: the closed code, whether retrying may help, and any module it names. */
export class ServerModsError extends Error {
    /** Records the code, retryability, a named module and (for a rejected upload) the rejection code. */
    constructor(readonly code: string, readonly retryable = false, readonly modId: string | null = null, readonly detail: string | null = null) {
        super(code);
        this.name = "ServerModsError";
    }
}

/** Whether a mod is an owner mod: neither a pinned core module nor the required Coop module. */
export function isOwnerMod(mod: ServerMod): boolean {
    return !mod.pinned && !mod.required;
}

/** Moves a movable mod, keeping it between the pinned head modules and the pinned tail module. */
export function moveServerMod(mods: readonly ServerMod[], fromIndex: number, toIndex: number): ServerMod[] {
    const moving = mods[fromIndex];
    if (!moving || moving.pinned) return [...mods];
    const first = mods.findIndex(mod => !mod.pinned);
    const last = mods.length - 1 - [...mods].reverse().findIndex(mod => !mod.pinned);
    const target = Math.min(Math.max(toIndex, first), last);
    if (target === fromIndex) return [...mods];
    const next = mods.filter((_, index) => index !== fromIndex);
    next.splice(target, 0, moving);
    return next;
}

/** Flips an owner mod's enabled flag; pinned and required modules stay enabled. */
export function toggleServerMod(mods: readonly ServerMod[], id: string): ServerMod[] {
    return mods.map(mod => mod.id !== id || !isOwnerMod(mod) ? mod : { ...mod, enabled: !mod.enabled });
}

/** Returns the complete requested order the load-order route takes. */
export function serverModLoadOrder(mods: readonly ServerMod[]): ServerModOrderEntry[] {
    return mods.map(({ id, enabled }) => ({ id, enabled }));
}

/** Whether two lists request the same order and enabled flags. */
export function sameServerModOrder(left: readonly ServerMod[], right: readonly ServerMod[]): boolean {
    return left.length === right.length && left.every((mod, index) => mod.id === right[index].id && mod.enabled === right[index].enabled);
}

/** Counts enabled owner mods, which the control plane caps at 32. */
export function enabledOwnerModCount(mods: readonly ServerMod[]): number {
    return mods.filter(mod => isOwnerMod(mod) && mod.enabled).length;
}

/** Returns the installed mod with this id, compared case-insensitively as the control plane does. */
export function findServerMod(mods: readonly ServerMod[], id: string): ServerMod | undefined {
    const folded = id.toLowerCase();
    return mods.find(mod => mod.id.toLowerCase() === folded);
}
