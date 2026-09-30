import "server-only";
import { listAllMyServers as collectServers, MyServersApiError, readMyServersResponse } from "./my-servers";
import { parseOnboardingSummary } from "../../../../supabase/functions/_shared/server-onboarding-contract";

/** Reads owner inventory directly; Oracle rechecks the current session and durable access on every page. */
export async function listAllMyServers(accessToken: string, callerSignal?: AbortSignal) {
    const signal = ownerReadSignal(accessToken, callerSignal);
    return collectServers(accessToken, signal, (token, cursor) => readOwner(token,
        { operation: "my-servers", input: { cursor, limit: 100 } }, signal));
}

/** Called after website account synchronization; eligibility and capacity are freshly checked by Oracle. */
export async function getServerOnboarding(accessToken: string, callerSignal?: AbortSignal) {
    const result = await readOwner(accessToken, { operation: "server-onboarding", input: {} }, ownerReadSignal(accessToken, callerSignal));
    try { return parseOnboardingSummary(result); }
    catch { throw new MyServersApiError("invalid_response", "The managed-server API returned an invalid response.", true); }
}

function ownerReadSignal(accessToken: string, callerSignal?: AbortSignal) {
    if (accessToken.length < 20 || accessToken.length > 8_192) {
        throw new MyServersApiError("invalid_request", "The managed-server read request is invalid.");
    }
    return callerSignal
        ? AbortSignal.any([callerSignal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
}

async function readOwner(accessToken: string, request:
    | { operation: "my-servers"; input: { cursor: string | null; limit: 100 } }
    | { operation: "server-onboarding"; input: Record<string, never> }, signal: AbortSignal) {
    const requestId = crypto.randomUUID();
    let response: Response;
    try {
        signal.throwIfAborted();
        response = await fetch("https://control-plane.bannerlordcoop.com/v1/user/control-plane", {
            method: "POST", credentials: "omit", cache: "no-store", redirect: "manual", signal,
            headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json",
                accept: "application/json", "x-request-id": requestId },
            body: JSON.stringify({ version: 1, requestId, ...request }),
        });
    } catch {
        throw new MyServersApiError("server_api_unavailable", "The managed-server API could not be reached.", true);
    }
    const length = response.headers.get("content-length");
    if ((response.status >= 300 && response.status < 400)
        || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
        || (length !== null && !/^(?:0|[1-9][0-9]*)$/.test(length))) {
        void response.body?.cancel().catch(() => undefined);
        throw new MyServersApiError("invalid_response", "The managed-server API returned an invalid response.", true);
    }
    return readMyServersResponse(response, requestId,
        { signal, maximumBytes: request.operation === "server-onboarding" ? 65_536 : undefined });
}
