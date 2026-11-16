import { MyServersApiError } from "./my-servers";
import type { Translator } from "@/app/lib/localization/types";
import { isWarSailsFailureCode, warSailsFailureMessage } from "./war-sails";

// Only known admission refusals can settle a retained request. Transport errors, authorization
// before replay lookup, conflicts with an older UUID, and errors naming accepted jobs cannot.
const REFUSAL_CODES = new Set([
    "server_suspended", "safe_stop_required", "operation_unavailable",
    "save_not_found", "save_still_loaded", "confirmation_mismatch", "active_save_delete_forbidden",
    "packaged_save_delete_forbidden", "backup_not_found", "backup_expired", "backup_unavailable",
    "backup_build_mismatch", "no_update_available", "validated_build_unavailable", "nightly_unavailable",
    "release_compatibility_unknown", "release_compatibility_unsafe", "settings_unchanged",
    "first_start_required", "impersonation_read_only", "battle_size_runner_unsupported",
    "war_sails_save_mismatch", "war_sails_unsupported",
]);

/** Returns safe owner copy only for a parsed, definitive refusal; null preserves existing recovery. */
export function ownerRefusalMessage(error: unknown, t: Translator["t"]): string | null {
    if (!(error instanceof MyServersApiError) || !error.parsedEnvelope || error.retryable
        || error.operationId !== undefined || !REFUSAL_CODES.has(error.code)) return null;
    if (isWarSailsFailureCode(error.code)) return warSailsFailureMessage(error.code, t);
    return error.code === "server_suspended" ? t("action.refusal.serverSuspended") : error.message;
}
