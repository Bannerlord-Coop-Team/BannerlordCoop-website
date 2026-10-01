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
const RELOAD_CODES = new Set(["request_conflict", "configuration_unavailable", "security_check_failed"]);

function failure(error: unknown, notSubmitted = false): ManagedServerConfigResult {
    const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
    const messages: Record<string, string> = {
        server_not_found: "This server is unavailable or your access changed.",
        identity_unavailable: "Link your Discord account before changing configuration.",
        request_conflict: "The configuration changed or another server operation is in progress. Reload the settings before saving again.",
        configuration_unavailable: "The server runner could not confirm this configuration. Reload the settings to check what is saved.",
        agent_target_unavailable: "This server has no active runner right now, so its configuration cannot be read.",
        managed_agent_or_resolver_unavailable: "The server runner is unavailable right now. Try again later.",
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
