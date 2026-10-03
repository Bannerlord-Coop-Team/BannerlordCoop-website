"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { submitMyServerConsoleCommand, getMyServerConsoleResult, acknowledgeMyServerConsoleResult } from "@/app/lib/hosting/server-console";
import { parseConsoleSubmission, parseConsoleReference, requireConsoleUuid } from "../../../supabase/functions/_shared/server-console-contract";

/** Binds every console action to the account that rendered this server page. */
async function currentToken(expectedUserId: string) {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || user.id !== expectedUserId || !session || session.user.id !== user.id) throw new Error("Authentication changed");
    return session.access_token;
}

/** Distinguishes local rejection from uncertain submissions without exposing internal errors. */
async function failure(error: unknown, notSubmitted = false) {
    const { t } = await getTranslations("managed-server");
    const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
    const messages: Record<string, string> = {
        server_not_found: t("action.console.thisServerIsUnavailableOrYourAccessChanged"),
        identity_unavailable: t("action.console.linkYourDiscordAccountAndSignInAgainBeforeUsing"),
        operation_unavailable: t("action.console.theServerIsNotRunningRefreshServerStatusIfDelivery"),
        request_conflict: t("action.console.theServerChangedOrAnotherCommandIsActiveCheckConsole"),
        invalid_request: t("action.console.enterOneSupportedCoopCommandWithValidArguments"),
        rate_limited: t("action.console.tooManyRequestsWaitBeforeCheckingAgain"),
    };
    return { ok: false as const, notSubmitted, message: notSubmitted
        ? t("action.console.theCommandWasNotSentCheckYourCommandAndSign")
        : messages[code] ?? t("action.console.theOutcomeCouldNotBeConfirmedCheckConsoleOutputOr") };
}

/** Validates and authenticates an enqueue while preserving the caller's durable request ID. */
export async function submitManagedConsoleCommand(input: unknown, requestId: string, expectedUserId: string) {
    let submissionStarted = false;
    try {
        const parsed = parseConsoleSubmission(input);
        requireConsoleUuid(requestId);
        const token = await currentToken(expectedUserId);
        submissionStarted = true;
        return { ok: true as const, result: await submitMyServerConsoleCommand(token, requestId, parsed) };
    } catch (error) { return await failure(error, !submissionStarted); }
}

/** Fetches the command result under current account and backend operate authorization. */
export async function checkManagedConsoleCommand(input: unknown, expectedUserId: string) {
    try {
        const reference = parseConsoleReference(input);
        return { ok: true as const, result: await getMyServerConsoleResult(await currentToken(expectedUserId), reference) };
    } catch (error) { return await failure(error); }
}

/** Suppresses Discord recovery only after the user acknowledges the displayed terminal result. */
export async function acknowledgeManagedConsoleCommand(input: unknown, expectedUserId: string) {
    try {
        const reference = parseConsoleReference(input);
        return { ok: true as const, result: await acknowledgeMyServerConsoleResult(await currentToken(expectedUserId), reference) };
    } catch (error) { return await failure(error); }
}
