import { MyServersApiError } from "@/app/lib/hosting/my-servers";

const UNCERTAIN_ERROR_CODES = new Set([
    "control_plane_unavailable",
    "invalid_response",
    "response_too_large",
    "server_api_unavailable",
]);

export function backupRequestOutcomeIsUncertain(error: unknown) {
    return !(error instanceof MyServersApiError) || UNCERTAIN_ERROR_CODES.has(error.code);
}
