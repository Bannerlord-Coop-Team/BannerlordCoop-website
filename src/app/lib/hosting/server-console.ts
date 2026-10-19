import { requestMyServersApi } from "./my-servers";
import {
    MAXIMUM_CONSOLE_RESPONSE_BYTES, parseConsoleSubmission, parseConsoleReference,
    parseConsoleReceipt, parseConsoleResult, parseConsoleAcknowledgement, requireConsoleUuid,
    type ConsoleSubmission, type ConsoleReference,
} from "../../../../supabase/functions/_shared/server-console-contract";

/** Submits one command with its original UUID so an uncertain response can be replayed safely. */
export async function submitMyServerConsoleCommand(token: string, requestId: string, input: ConsoleSubmission) {
    requireConsoleUuid(requestId);
    return parseConsoleReceipt(await requestMyServersApi(token, {
        method: "POST", requestId, body: JSON.stringify({ action: "console-command", ...parseConsoleSubmission(input) }),
    }));
}

/** Reads one request-bound result with a fresh envelope ID and a console-only response bound. */
export async function getMyServerConsoleResult(token: string, input: ConsoleReference) {
    return parseConsoleResult(await requestMyServersApi(token, {
        method: "POST", maximumResponseBytes: MAXIMUM_CONSOLE_RESPONSE_BYTES,
        body: JSON.stringify({ action: "console-command-result", ...parseConsoleReference(input) }),
    }));
}

/** Acknowledges a displayed result without submitting another game command. */
export async function acknowledgeMyServerConsoleResult(token: string, input: ConsoleReference) {
    return parseConsoleAcknowledgement(await requestMyServersApi(token, {
        method: "POST", body: JSON.stringify({ action: "acknowledge-console-command", ...parseConsoleReference(input) }),
    }));
}
