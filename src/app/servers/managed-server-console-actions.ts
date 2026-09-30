"use server";

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
function failure(error: unknown, notSubmitted = false) {
    const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
    const messages: Record<string, string> = {
        server_not_found: "This server is unavailable or your access changed.",
        identity_unavailable: "Link your Discord account and sign in again before using commands.",
        operation_unavailable: "The server is not running. Refresh server status; if delivery was previously uncertain, check Discord before sending a new command.",
        request_conflict: "The server changed or another command is active. Keep this request; check its outcome before sending a new command.",
        invalid_request: "Enter one supported coop.* command with valid arguments.",
        rate_limited: "Too many requests. Wait before checking again.",
    };
    return { ok: false as const, notSubmitted, message: notSubmitted
        ? "The command was not sent. Check your command and sign-in session."
        : messages[code] ?? "The outcome could not be confirmed. Retry only this same request or check Discord; do not resend as a new command." };
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
    } catch (error) { return failure(error, !submissionStarted); }
}

/** Fetches the command result under current account and backend operate authorization. */
export async function checkManagedConsoleCommand(input: unknown, expectedUserId: string) {
    try {
        const reference = parseConsoleReference(input);
        return { ok: true as const, result: await getMyServerConsoleResult(await currentToken(expectedUserId), reference) };
    } catch (error) { return failure(error); }
}

/** Suppresses Discord recovery only after the user acknowledges the displayed terminal result. */
export async function acknowledgeManagedConsoleCommand(input: unknown, expectedUserId: string) {
    try {
        const reference = parseConsoleReference(input);
        return { ok: true as const, result: await acknowledgeMyServerConsoleResult(await currentToken(expectedUserId), reference) };
    } catch (error) { return failure(error); }
}
