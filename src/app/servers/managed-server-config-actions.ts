"use server";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { getMyServerConfiguration, saveMyServerConfiguration } from "@/app/lib/hosting/server-configuration";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { requireUuid } from "../../../supabase/functions/_shared/server-file-contract";
import {
    parseRunnerConfigurationMutation,
    requireRunnerConfigurationPart,
    type RunnerConfigurationFile,
} from "../../../supabase/functions/_shared/server-configuration-contract";

export type ManagedServerConfigResult =
    | { ok: true; file: RunnerConfigurationFile }
    | { ok: false; message: string; reload: boolean; notSubmitted: boolean };

async function currentToken(expectedUserId: string) {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || user.id !== expectedUserId || !session) throw new Error("Authentication changed");
    return session.access_token;
}

// Revision or operation conflicts need a fresh read; everything else can be retried as-is.
const RELOAD_CODES = new Set(["request_conflict", "configuration_unavailable", "security_check_failed", "idempotency_conflict"]);

function failure(error: unknown, notSubmitted = false): ManagedServerConfigResult {
    const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
    const runnerUnavailable = "The server runner did not respond. Try again in a moment.";
    const runnerRejected = "The server runner rejected this request. Reload the page and try again.";
    const messages: Record<string, string> = {
        server_not_found: "This server is unavailable or your access changed.",
        identity_unavailable: "Link your Discord account before changing configuration.",
        request_conflict: "The configuration changed or another server operation is in progress. Reload the settings before saving again.",
        configuration_unavailable: "The server runner could not confirm this configuration. Reload the settings to check what is saved.",
        idempotency_conflict: "The file changed on the runner since you loaded it. Reload the settings before saving again.",
        agent_target_unavailable: "This server has no active runner right now, so its configuration cannot be read.",
        agent_target_invalid: "This server's runner assignment is out of date. Refresh the page and try again.",
        managed_agent_or_resolver_unavailable: "The server runner is unavailable right now. Try again later.",
        agent_transport_unavailable: runnerUnavailable,
        storage_unavailable: runnerUnavailable,
        internal_error: runnerUnavailable,
        agent_request_invalid: runnerRejected,
        agent_correlation_invalid: runnerRejected,
        agent_request_failed: runnerRejected,
        request_rejected: runnerRejected,
        route_unavailable: "The server runner is running an older version that cannot edit configuration yet.",
        not_found: "The runner has no configuration file for this server yet. Start the server once, then reload the settings.",
        integrity_failed: "The runner refused this configuration file because it failed an integrity check.",
        agent_response_invalid: "The server runner returned an unreadable response. Try again.",
        configuration_response_invalid: "The runner's configuration file contains settings this page does not understand.",
        control_plane_failure: "The hosting service hit an unexpected error. Try again.",
        runtime_unavailable: "The hosting service is not ready for runner operations right now. Try again later.",
        rate_limited: "Too many requests were sent. Wait a moment and try again.",
        control_plane_unavailable: "The hosting service could not be reached. Try again.",
        server_api_unavailable: "The hosting service could not be reached. Try again.",
        invalid_request: "The settings were rejected. Check the values and try again.",
    };
    return { ok: false, notSubmitted, reload: !notSubmitted && RELOAD_CODES.has(code),
        message: notSubmitted ? "The settings were not sent. Check the values and try again."
            : messages[code] ?? "The change could not be confirmed. Reload the settings to check whether it was saved." };
}

export async function readManagedServerConfig(serverId: string, configPart: string, expectedUserId: string): Promise<ManagedServerConfigResult> {
    try {
        requireUuid(serverId); requireRunnerConfigurationPart(configPart);
        return { ok: true, file: await getMyServerConfiguration(await currentToken(expectedUserId), serverId, configPart) };
    } catch (error) { return failure(error); }
}

export async function saveManagedServerConfig(input: unknown, expectedUserId: string): Promise<ManagedServerConfigResult> {
    let submissionStarted = false;
    try {
        const token = await currentToken(expectedUserId);
        if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Invalid configuration request");
        const { requestId, ...mutation } = input as Record<string, unknown>;
        requireUuid(requestId);
        const parsed = parseRunnerConfigurationMutation(mutation);
        submissionStarted = true;
        return { ok: true, file: await saveMyServerConfiguration(token, requestId, parsed) };
    } catch (error) { return failure(error, !submissionStarted); }
}
