import type { Translator } from "@/app/lib/localization/types";
import type { ModArchiveError } from "@/app/lib/hosting/server-mod-archive";
import type { ServerModsError } from "@/app/lib/hosting/server-mods";
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
};
const ISSUE_KEYS: Readonly<Record<string, string>> = {
    "missing-dependency": "mods.issue.missingDependency",
    "dependency-order": "mods.issue.dependencyOrder",
    stripped: "mods.issue.stripped",
    "image-module-not-loaded": "mods.issue.imageModuleNotLoaded",
};

/** Describes one installed-mod note (`kind` or `kind:value`) in owner language. */
export function describeModIssue(issue: string, t: Translate): string {
    if (issue === "enabled-limit") return t("mods.issue.enabledLimit");
    if (issue === "dedicated-server-tag-removed") return t("mods.issue.dedicatedServerTagRemoved");
    const separator = issue.indexOf(":");
    const key = separator < 0 ? undefined : ISSUE_KEYS[issue.slice(0, separator)];
    return key === undefined ? t("mods.issue.other", { issue }) : t(key, { value: issue.slice(separator + 1) });
}

/** Explains a refused or unconfirmed catalog call; `modId` names the module the refusal concerns. */
export function modsErrorMessage(error: ServerModsError, t: Translate): string {
    const id = error.modId ?? "";
    if (error.code === "upload_rejected") {
        if (error.detail === "mod_reserved_id") return t("mods.error.reservedId", { id });
        return t(REJECTION_KEYS[error.detail ?? ""] ?? "mods.rejected.other");
    }
    if (error.code === "upload_failed") return t("mods.error.uploadFailed", { id });
    if (error.code === "upload_unconfirmed") return t("mods.error.uploadUnconfirmed", { id });
    if (error.code === "mod_reserved_id") return t("mods.error.reservedId", { id });
    if (error.code === "mod_order_invalid") return error.modId ? t("mods.error.orderInvalidMod", { id }) : t("mods.error.orderInvalid");
    if (error.code === "mod_dependency_unsatisfied") return error.modId ? t("mods.error.dependencyUnsatisfiedMod", { id }) : t("mods.error.dependencyUnsatisfied");
    if (UNAVAILABLE_CODES.has(error.code)) return t("mods.error.unavailable");
    const key = SIMPLE_ERROR_KEYS[error.code];
    return key === undefined ? t("mods.error.other") : t(key);
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
