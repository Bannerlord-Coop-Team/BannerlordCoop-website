// pinned: fixed at the top of the load order. required: always enabled and cannot be deleted.
export type ServerMod = {
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    pinned: boolean;
    required: boolean;
};

// Supplies a server's mod load order; swap the mock for a control-plane source when mods are persisted.
export interface ServerModCatalog {
    listServerMods(serverId: string): Promise<ServerMod[]>;
}

const coreMods: ServerMod[] = [
    { id: "Native", name: "Native", version: "v1.2.12", enabled: true, pinned: true, required: true },
    { id: "SandBoxCore", name: "SandBox Core", version: "v1.2.12", enabled: true, pinned: true, required: true },
    { id: "Sandbox", name: "SandBox", version: "v1.2.12", enabled: true, pinned: true, required: true },
    { id: "StoryMode", name: "Story Mode", version: "v1.2.12", enabled: true, pinned: true, required: true },
];

const sampleMods: ServerMod[] = [
    { id: "Coop", name: "Bannerlord Coop", version: "v0.1.0", enabled: true, pinned: false, required: true },
    { id: "Bannerlord.ButterLib", name: "ButterLib", version: "v2.9.18", enabled: true, pinned: false, required: false },
    { id: "Bannerlord.UIExtenderEx", name: "UIExtenderEx", version: "v2.12.0", enabled: true, pinned: false, required: false },
    { id: "Bannerlord.MBOptionScreen", name: "Mod Configuration Menu", version: "v5.10.2", enabled: true, pinned: false, required: false },
    { id: "Diplomacy", name: "Diplomacy", version: "v1.2.9", enabled: false, pinned: false, required: false },
    { id: "ImprovedGarrisons", name: "Improved Garrisons", version: "v1.6.2", enabled: true, pinned: false, required: false },
];

// Returns sample mods so the Mods tab can be built before the control plane exposes mod state.
export const mockServerModCatalog: ServerModCatalog = {
    async listServerMods() {
        return [...coreMods, ...sampleMods].map(mod => ({ ...mod }));
    },
};

// Moves an unpinned mod to a new position, keeping it below the pinned core modules.
export function moveServerMod(mods: readonly ServerMod[], fromIndex: number, toIndex: number): ServerMod[] {
    const moving = mods[fromIndex];
    if (!moving || moving.pinned) return [...mods];
    const firstMovableIndex = mods.findIndex(mod => !mod.pinned);
    const target = Math.min(Math.max(toIndex, firstMovableIndex), mods.length - 1);
    if (target === fromIndex) return [...mods];
    const next = mods.filter((_, index) => index !== fromIndex);
    next.splice(target, 0, moving);
    return next;
}

// Flips a mod's enabled flag unless the mod is required.
export function toggleServerMod(mods: readonly ServerMod[], id: string): ServerMod[] {
    return mods.map(mod => mod.id !== id || mod.required ? mod : { ...mod, enabled: !mod.enabled });
}

// Removes a mod from the list unless the mod is required.
export function removeServerMod(mods: readonly ServerMod[], id: string): ServerMod[] {
    return mods.filter(mod => mod.id !== id || mod.required);
}

// Builds a disabled mod entry from a module's SubModule.xml; null when the manifest has no module Id.
export function parseSubModuleManifest(xml: string): ServerMod | null {
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) return null;
    const read = (tag: string) => document.querySelector(`Module > ${tag}`)?.getAttribute("value")?.trim() ?? "";
    const id = read("Id");
    if (!id) return null;
    return { id, name: read("Name") || id, version: read("Version") || "Unknown version", enabled: false, pinned: false, required: false };
}

// Returns the SubModule.xml at the top level of a picked module folder (e.g. ButterLib/SubModule.xml), or null.
export function findModuleFolderManifest<T extends { webkitRelativePath: string }>(files: readonly T[]): T | null {
    return files.find(file => {
        const segments = file.webkitRelativePath.split("/");
        return segments.length === 2 && segments[1].toLowerCase() === "submodule.xml";
    }) ?? null;
}

// Appends a mod to the end of the load order; null when a mod with the same id already exists.
export function addServerMod(mods: readonly ServerMod[], mod: ServerMod): ServerMod[] | null {
    const id = mod.id.toLowerCase();
    if (mods.some(existing => existing.id.toLowerCase() === id)) return null;
    return [...mods, mod];
}
