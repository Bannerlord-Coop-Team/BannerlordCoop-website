import { ServerModsError, findServerMod, isOwnerMod, type ServerMod, type ServerModCatalog, type ServerModsState } from "./server-mods";

// An in-memory ServerModCatalog with the control plane's observable rules (revision checks, pinned and
// required modules, dependency refusals, in-place replacement), for component tests and UI work.

/** Builds an image module entry. */
function imageModule(id: string, kind: "pinned" | "required"): ServerMod {
    return { id, name: id, version: "", enabled: true, pinned: kind === "pinned", required: kind === "required", sizeBytes: 0, sha256: null, dependsOn: [], issues: [] };
}

/** Builds an owner mod entry with optional overrides. */
export function sampleOwnerMod(id: string, overrides: Partial<ServerMod> = {}): ServerMod {
    return { id, name: id, version: "v1.0.0", enabled: true, pinned: false, required: false, sizeBytes: 1_024, sha256: "0".repeat(64), dependsOn: [], issues: [], ...overrides };
}

/** The fixed baseline shape: three pinned head modules, Coop, owner mods, and the pinned tail. */
export function sampleServerMods(ownerMods: ServerMod[] = []): ServerMod[] {
    return [imageModule("Native", "pinned"), imageModule("SandBoxCore", "pinned"), imageModule("SandBox", "pinned"),
        imageModule("Coop", "required"), ...ownerMods, imageModule("DedicatedServer.Linux", "pinned")];
}

/** Renders a counter as a revision-shaped digest. */
function revisionOf(generation: number): string {
    return generation.toString(16).padStart(64, "0");
}

export type MockServerModCatalog = ServerModCatalog & { readonly state: ServerModsState };

/** Builds a mock over `mods`; `running` makes every change report `restartRequired`. */
export function createMockServerModCatalog(mods: ServerMod[] = sampleServerMods(), options: { running?: boolean } = {}): MockServerModCatalog {
    let generation = 1;
    let state: ServerModsState = { revision: revisionOf(generation), restartRequired: false, mods: mods.map(mod => ({ ...mod })) };

    /** Refuses an edit based on an older list. */
    function requireRevision(expectedRevision: string) {
        if (expectedRevision !== state.revision) throw new ServerModsError("revision_conflict");
    }

    /** Commits a new list under the next revision. */
    function commit(next: ServerMod[]): ServerModsState {
        generation += 1;
        state = { revision: revisionOf(generation), restartRequired: options.running === true, mods: next };
        return structuredClone(state);
    }

    return {
        get state() { return structuredClone(state); },
        async listServerMods() {
            return structuredClone(state);
        },
        async saveServerModOrder(_serverId, expectedRevision, order) {
            requireRevision(expectedRevision);
            const byId = new Map(state.mods.map(mod => [mod.id, mod]));
            if (order.length !== byId.size || order.some(entry => !byId.has(entry.id))) throw new ServerModsError("invalid_request");
            const next = order.map(entry => ({ ...byId.get(entry.id)!, enabled: isOwnerMod(byId.get(entry.id)!) ? entry.enabled : true }));
            const movedPin = next.find((mod, index) => mod.pinned && state.mods[index].id !== mod.id);
            if (movedPin) throw new ServerModsError("mod_order_invalid", false, movedPin.id);
            return commit(next);
        },
        async deleteServerMod(_serverId, expectedRevision, modId) {
            requireRevision(expectedRevision);
            const target = findServerMod(state.mods, modId);
            if (!target || !isOwnerMod(target)) throw new ServerModsError("invalid_request");
            const dependent = state.mods.find(mod => mod.enabled && mod.dependsOn.some(id => id.toLowerCase() === modId.toLowerCase()));
            if (dependent) throw new ServerModsError("mod_dependency_unsatisfied", false, dependent.id);
            return commit(state.mods.filter(mod => mod !== target));
        },
        async uploadServerMod(_serverId, expectedRevision, archive, onProgress = () => {}) {
            requireRevision(expectedRevision);
            const totalBytes = archive.bytes.byteLength;
            onProgress({ phase: "creating", sentBytes: 0, totalBytes });
            onProgress({ phase: "uploading", sentBytes: totalBytes, totalBytes });
            onProgress({ phase: "installing", sentBytes: totalBytes, totalBytes });
            const installed = sampleOwnerMod(archive.manifest.id, { name: archive.manifest.name, version: archive.manifest.version, sizeBytes: archive.uncompressedBytes });
            const existing = findServerMod(state.mods, archive.manifest.id);
            if (existing) return commit(state.mods.map(mod => mod === existing ? { ...installed, enabled: existing.enabled } : mod));
            const next = [...state.mods];
            next.splice(next.length - 1, 0, installed);
            return commit(next);
        },
    };
}
