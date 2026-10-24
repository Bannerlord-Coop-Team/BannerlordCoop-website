import { ServerModsError, findServerMod, isOwnerMod, type ServerMod, type ServerModCatalog, type ServerModOrderEntry, type ServerModsState } from "@/app/lib/hosting/server-mods";

// An in-memory ServerModCatalog for the Mods panel's component tests, imitating the control plane's observable
// rules (revision checks, pinned and required modules, dependency refusals, in-place replacement, runs-on rules).
// Its runs-on rules are written out from contract C3 rather than taken from the website's helpers, so a wrong
// website predicate is refused here as the control plane would refuse it.

/** C3 section 3: uploads with these ids (case-insensitive) default to players-only; Harmony is also locked. */
const CP_PLAYERS_DEFAULT_IDS: ReadonlySet<string> = new Set(["bannerlord.harmony", "itemqualityindicator", "bannerlord.familytree", "familyappearanceeditor"]);
const CP_HARMONY_ID = "bannerlord.harmony";
/** C3 F17: the issue a `submodule-invalid` lock names when the owner tries the server anyway. */
const CP_F17_ISSUE_PREFIXES = ["submodule-class-missing:", "submodule-dll-missing:", "submodule-dll-unreadable:"];

/** Builds an image module entry; `runsOn` adds the locked core-module fields a players-only control plane reports. */
function imageModule(id: string, kind: "pinned" | "required", runsOn: boolean): ServerMod {
    const entry: ServerMod = { id, name: id, version: "", enabled: true, pinned: kind === "pinned", required: kind === "required", sizeBytes: 0, sha256: null, dependsOn: [], issues: [] };
    return runsOn ? { ...entry, runsOn: "server", runsOnDefault: "server", runsOnLocked: true, runsOnLockReason: "core-module" } : entry;
}

/** Builds an owner mod entry with optional overrides. */
export function sampleOwnerMod(id: string, overrides: Partial<ServerMod> = {}): ServerMod {
    return { id, name: id, version: "v1.0.0", enabled: true, pinned: false, required: false, sizeBytes: 1_024, sha256: "0".repeat(64), dependsOn: [], issues: [], ...overrides };
}

/** The fixed baseline shape: three pinned head modules, Coop, owner mods, and the pinned tail; image entries report runs-on when owner mods do. */
export function sampleServerMods(ownerMods: ServerMod[] = []): ServerMod[] {
    const runsOn = ownerMods.some(mod => mod.runsOn !== undefined);
    return [imageModule("Native", "pinned", runsOn), imageModule("SandBoxCore", "pinned", runsOn), imageModule("SandBox", "pinned", runsOn),
        imageModule("Coop", "required", runsOn), ...ownerMods, imageModule("DedicatedServer.Linux", "pinned", runsOn)];
}

/** Renders a counter as a revision-shaped digest. */
function revisionOf(generation: number): string {
    return generation.toString(16).padStart(64, "0");
}

/** Applies a requested `runsOn` as C3 section 2 says, by the entry's lock reason: core and server-provided refuse, an old runner refuses any change, F17 names its issue. */
function applyRunsOn(mod: ServerMod, entry: ServerModOrderEntry): ServerMod {
    if (entry.runsOn === undefined || entry.runsOn === mod.runsOn) return mod;
    if (mod.runsOn === undefined) throw new ServerModsError("invalid_request");
    if (!mod.runsOnLocked) return { ...mod, runsOn: entry.runsOn };
    if (mod.runsOnLockReason === "runner-unsupported") throw new ServerModsError("runner_unsupported");
    const f17 = mod.runsOnLockReason === "submodule-invalid" ? mod.issues.find(issue => CP_F17_ISSUE_PREFIXES.some(prefix => issue.startsWith(prefix))) : undefined;
    throw new ServerModsError("mod_order_invalid", false, mod.id, f17 ?? null);
}

/** Returns a new upload's runs-on fields as C3 section 3 defaults them, or nothing when the list does not report runs-on. */
function uploadRunsOn(id: string, reportsRunsOn: boolean): Partial<ServerMod> {
    if (!reportsRunsOn) return {};
    const folded = id.toLowerCase();
    const runsOnDefault = CP_PLAYERS_DEFAULT_IDS.has(folded) ? "players" : "server";
    const lock = folded === CP_HARMONY_ID ? { runsOnLocked: true, runsOnLockReason: "server-provided" } : { runsOnLocked: false };
    return { runsOn: runsOnDefault, runsOnDefault, ...lock };
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
            const next = order.map(entry => applyRunsOn({ ...byId.get(entry.id)!, enabled: isOwnerMod(byId.get(entry.id)!) ? entry.enabled : true }, entry));
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
            const runsOn = uploadRunsOn(archive.manifest.id, state.mods.some(mod => mod.runsOn !== undefined));
            const installed = sampleOwnerMod(archive.manifest.id, { name: archive.manifest.name, version: archive.manifest.version, sizeBytes: archive.uncompressedBytes, ...runsOn });
            const existing = findServerMod(state.mods, archive.manifest.id);
            if (existing) return commit(state.mods.map(mod => mod === existing ? { ...installed, enabled: existing.enabled, ...(existing.runsOn === undefined ? {} : { runsOn: existing.runsOn }) } : mod));
            const next = [...state.mods];
            next.splice(next.length - 1, 0, installed);
            return commit(next);
        },
    };
}
