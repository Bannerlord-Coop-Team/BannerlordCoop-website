"use server";

import { getTranslations } from "@/app/lib/localization/server";

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

// Binds the existing operation to the authenticated page account.
async function currentToken(expectedUserId: string) {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || user.id !== expectedUserId || !session) throw new Error("Authentication changed");
    return session.access_token;
}

// Revision or operation conflicts need a fresh read; everything else can be retried as-is.
const RELOAD_CODES = new Set(["request_conflict", "configuration_unavailable", "security_check_failed"]);

// Localizes existing action-specific failure codes without exposing internal errors.
async function failure(error: unknown, notSubmitted = false): Promise<ManagedServerConfigResult> {
    const { t } = await getTranslations("managed-server");
    const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
    const messages: Record<string, string> = {
        server_not_found: t("action.config.thisServerIsUnavailableOrYourAccessChanged"),
        identity_unavailable: t("action.config.linkYourDiscordAccountBeforeChangingConfiguration"),
        request_conflict: t("action.config.theConfigurationChangedOrAnotherServerOperationIsInProgress"),
        configuration_unavailable: t("action.config.theServerRunnerCouldNotConfirmThisConfigurationReloadThe"),
        agent_target_unavailable: t("action.config.thisServerHasNoActiveRunnerRightNowSoIts"),
        managed_agent_or_resolver_unavailable: t("action.config.theServerRunnerIsUnavailableRightNowTryAgainLater"),
        rate_limited: t("action.config.tooManyRequestsWereSentWaitAMomentAndTry"),
        control_plane_unavailable: t("action.config.theHostingServiceCouldNotBeReachedTryAgain"),
        server_api_unavailable: t("action.config.theHostingServiceCouldNotBeReachedTryAgain"),
        invalid_request: t("action.config.theSettingsWereRejectedCheckTheValuesAndTryAgain"),
    };
    return { ok: false, notSubmitted, reload: !notSubmitted && RELOAD_CODES.has(code),
        message: notSubmitted ? t("action.config.theSettingsWereNotSentCheckTheValuesAndTry")
            : messages[code] ?? t("action.config.theChangeCouldNotBeConfirmedReloadTheSettingsTo") };
}

// Authenticates a configuration read and presents existing failure outcomes.
export async function readManagedServerConfig(serverId: string, configPart: string, expectedUserId: string): Promise<ManagedServerConfigResult> {
    try {
        requireUuid(serverId); requireRunnerConfigurationPart(configPart);
        return { ok: true, file: await getMyServerConfiguration(await currentToken(expectedUserId), serverId, configPart) };
    } catch (error) { return await failure(error); }
}

// Authenticates and validates configuration writes without changing their inputs.
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
    } catch (error) { return await failure(error, !submissionStarted); }
}
