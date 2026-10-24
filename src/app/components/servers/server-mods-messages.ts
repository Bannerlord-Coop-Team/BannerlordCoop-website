import type { Translator } from "@/app/lib/localization/types";
import type { ModArchiveError } from "@/app/lib/hosting/server-mod-archive";
import type { ServerMod, ServerModsError } from "@/app/lib/hosting/server-mods";
import type { ModRunsOnLockReason } from "../../../../supabase/functions/_shared/server-mods-contract";
import type { ModLoadFailure } from "@/app/lib/hosting/my-servers-server";

// Owner-facing copy for the Mods tab: installed-mod notes, API refusals and folder problems, each from a
// closed code. Codes the website does not know fall back to a generic message rather than raw API text.

type Translate = Translator["t"];

const UNAVAILABLE_CODES = new Set(["identity_unavailable", "server_api_unavailable", "control_plane_unavailable", "network_unavailable", "invalid_response", "server_api_not_configured"]);
const SIMPLE_ERROR_KEYS: Readonly<Record<string, string>> = {
    revision_conflict: "mods.error.revisionConflict",
    request_conflict: "mods.error.requestConflict",
    upload_busy: "mods.error.uploadBusy",
    upload_expired: "mods.error.uploadExpired",
    upload_not_found: "mods.error.uploadNotFound",
    upload_chunk_conflict: "mods.error.uploadInterrupted",
    upload_incomplete: "mods.error.uploadInterrupted",
    mod_storage_quota_exceeded: "mods.error.storageQuota",
    mods_unavailable: "mods.error.modsUnavailable",
    runner_unsupported: "mods.error.runnerUnsupported",
    server_not_found: "mods.error.serverNotFound",
    unauthenticated: "mods.error.unauthenticated",
    rate_limited: "mods.error.rateLimited",
    busy: "mods.error.rateLimited",
    request_too_large: "mods.error.requestTooLarge",
    invalid_request: "mods.error.invalidRequest",
};
const REJECTION_KEYS: Readonly<Record<string, string>> = {
    mod_archive_invalid: "mods.rejected.archiveInvalid",
    mod_manifest_mismatch: "mods.rejected.manifestMismatch",
    mod_submodule_invalid: "mods.rejected.submoduleInvalid",
    mod_assembly_conflict: "mods.rejected.assemblyConflict",
};
const PLAIN_ISSUE_KEYS: Readonly<Record<string, string>> = {
    "enabled-limit": "mods.issue.enabledLimit",
    "dedicated-server-tag-removed": "mods.issue.dedicatedServerTagRemoved",
    "no-render-tag-removed": "mods.issue.noRenderTagRemoved",
    "no-server-submodule": "mods.issue.noServerSubmodule",
    "headless-server-unsupported": "mods.issue.headlessServerUnsupported",
};
const ISSUE_KEYS: Readonly<Record<string, string>> = {
    "missing-dependency": "mods.issue.missingDependency",
    "dependency-order": "mods.issue.dependencyOrder",
    stripped: "mods.issue.stripped",
    "image-module-not-loaded": "mods.issue.imageModuleNotLoaded",
    "submodule-class-missing": "mods.issue.submoduleClassMissing",
    "submodule-dll-missing": "mods.issue.submoduleDllMissing",
    "submodule-dll-unreadable": "mods.issue.submoduleDllUnreadable",
};

/** Describes one installed-mod note (`kind` or `kind:value`) in owner language. */
export function describeModIssue(issue: string, t: Translate): string {
    const plain = PLAIN_ISSUE_KEYS[issue];
    if (plain !== undefined) return t(plain);
    const separator = issue.indexOf(":");
    const key = separator < 0 ? undefined : ISSUE_KEYS[issue.slice(0, separator)];
    return key === undefined ? t("mods.issue.other", { issue }) : t(key, { value: issue.slice(separator + 1) });
}

/** Explains a refused or unconfirmed catalog call; `changedRunsOn` are the mods whose runs-on the refused save changed. */
export function modsErrorMessage(error: ServerModsError, t: Translate, changedRunsOn: readonly ServerMod[] = []): string {
    const runsOn = runsOnRefusalMessage(error, changedRunsOn, t);
    if (runsOn !== null) return runsOn;
    if (error.code === "server_suspended" && !error.retryable) return t("action.refusal.serverSuspended");
    const id = error.modId ?? "";
    if (error.code === "upload_rejected") {
        if (error.detail === "mod_reserved_id") return t("mods.error.reservedId", { id });
        return t(REJECTION_KEYS[error.detail ?? ""] ?? "mods.rejected.other");
    }
    if (error.code === "upload_failed") return t("mods.error.uploadFailed", { id });
    if (error.code === "upload_unconfirmed") return t("mods.error.uploadUnconfirmed", { id });
    if (error.code === "upload_status_unavailable") return t("mods.error.uploadStatusUnavailable", { id });
    if (error.code === "mod_reserved_id") return t("mods.error.reservedId", { id });
    if (error.code === "mod_order_invalid") return error.modId ? t("mods.error.orderInvalidMod", { id }) : t("mods.error.orderInvalid");
    if (error.code === "mod_dependency_unsatisfied") return error.modId ? t("mods.error.dependencyUnsatisfiedMod", { id }) : t("mods.error.dependencyUnsatisfied");
    if (UNAVAILABLE_CODES.has(error.code)) return t("mods.error.unavailable");
    const key = SIMPLE_ERROR_KEYS[error.code];
    return key === undefined ? t("mods.error.other") : t(key);
}

/** Explains a refusal caused by a runs-on change (an unsupported runner, or server code the mod lacks); null for any other refusal. */
function runsOnRefusalMessage(error: ServerModsError, changedRunsOn: readonly ServerMod[], t: Translate): string | null {
    if (changedRunsOn.length === 0) return null;
    if (error.code === "runner_unsupported") return t("mods.runsOn.runnerUnsupported");
    // The control plane names an issue only when the switch itself was refused; a dependency order the same save broke names none.
    if (error.code !== "mod_order_invalid" || error.detail === null) return null;
    const named = error.modId?.toLowerCase();
    const refused = changedRunsOn.find(mod => mod.runsOn === "server" && mod.id.toLowerCase() === named);
    return refused === undefined ? null : t("mods.runsOn.serverRefused", { id: refused.id, reason: describeModIssue(error.detail, t) });
}

/** Copy for each known lock reason; a reason added to the contract's union does not compile until it has an entry here. */
const LOCKED_RUNS_ON_COPY: Readonly<Record<ModRunsOnLockReason, (players: boolean, t: Translate) => string>> = {
    // Core modules and Coop show no runs-on line, so this generic copy only covers an unexpected shape.
    "core-module": genericLockedRunsOn,
    // C3 gives this reason only where Harmony runs players-only; an old runner reports runner-unsupported instead.
    "server-provided": (_players, t) => t("mods.runsOn.serverProvided"),
    "runner-unsupported": (players, t) => t(players ? "mods.runsOn.fixedPlayers" : "mods.runsOn.fixedServer"),
    "submodule-invalid": (_players, t) => t("mods.runsOn.lockedSubmodule"),
};

/** Explains a runs-on value the owner cannot change from the control plane's lock reason; an unknown reason gets generic copy. */
export function lockedRunsOnMessage(mod: ServerMod, t: Translate): string {
    const reason = mod.runsOnLockReason;
    const copy = reason !== undefined && Object.hasOwn(LOCKED_RUNS_ON_COPY, reason) ? LOCKED_RUNS_ON_COPY[reason as ModRunsOnLockReason] : genericLockedRunsOn;
    return copy(mod.runsOn === "players", t);
}

/** Names the fixed runs-on value without a reason. */
function genericLockedRunsOn(players: boolean, t: Translate): string {
    return t("mods.runsOn.lockedOther", { value: t(players ? "mods.runsOn.players" : "mods.runsOn.server") });
}

/** Explains why a picked folder cannot be uploaded. */
export function archiveProblemMessage(error: ModArchiveError, t: Translate): string {
    const detail = error.detail ?? "";
    switch (error.problem) {
        case "no-folder": return t("mods.archive.noFolder");
        case "multiple-folders": return t("mods.archive.multipleFolders");
        case "no-submodule": return t("mods.archive.noSubmodule");
        case "submodule-invalid": return t("mods.archive.submoduleInvalid");
        case "invalid-id": return t("mods.archive.invalidId");
        case "reserved-id": return t("mods.error.reservedId", { id: detail });
        case "invalid-name": return t("mods.archive.invalidName");
        case "invalid-version": return t("mods.archive.invalidVersion");
        case "too-many-files": return t("mods.archive.tooManyFiles");
        case "too-large-uncompressed": return t("mods.archive.tooLargeUncompressed");
        case "too-large": return t("mods.archive.tooLarge");
        case "invalid-path": return t("mods.archive.invalidPath", { path: detail });
        case "duplicate-path": return t("mods.archive.duplicatePath", { path: detail });
        case "compression-ratio": return t("mods.archive.compressionRatio");
    }
}

/** Explains a Start that failed because an enabled mod did not load, naming the mod and any missing assembly. */
export function modLoadFailureMessage(failure: ModLoadFailure, t: Translate): string {
    if (failure.reason === "missing-assembly" && failure.assembly !== undefined) {
        if (failure.assembly === "0Harmony") return t("controls.modLoadFailedHarmony", { modId: failure.modId });
        return t("controls.modLoadFailedMissingAssembly", { modId: failure.modId, assembly: failure.assembly });
    }
    if (failure.reason === "missing-dll") return t("controls.modLoadFailedMissingDll", { modId: failure.modId });
    if (failure.reason === "load-error") return t("controls.modLoadFailed", { modId: failure.modId });
    return t("controls.modLoadFailedUnknown");
}
