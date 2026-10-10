import "server-only";
import { listAllMyServers as collectServers, MyServersApiError, readMyServersResponse, type MyServerDeletionStatus } from "./my-servers";
import { logLegacySummaryFallback, OnboardingDtoError, readOnboardingSummary, type OnboardingControlPlaneRequest } from "../../../../supabase/functions/_shared/server-onboarding-contract";

/** Reads owner inventory directly; Oracle rechecks the current session and durable access on every page. */
export async function listAllMyServers(accessToken: string, callerSignal?: AbortSignal) {
    const signal = ownerReadSignal(accessToken, callerSignal);
    return collectServers(accessToken, signal, (token, cursor) => readOwner(token,
        { operation: "my-servers", input: { cursor, limit: 100 } }, signal));
}

/** Called after website account synchronization; eligibility and capacity are freshly checked by Oracle. */
export async function getServerOnboarding(accessToken: string, callerSignal?: AbortSignal) {
    const signal = ownerReadSignal(accessToken, callerSignal);
    try {
        return await readOnboardingSummary((request, attempt) => {
            if (attempt === "legacy") logLegacySummaryFallback("website");
            return readOwner(accessToken, request, signal);
        }, isSummaryVersionRejection);
    }
    catch (error) {
        if (!(error instanceof OnboardingDtoError)) throw error;
        throw new MyServersApiError("invalid_response", "The managed-server API returned an invalid response.", true);
    }
}

/** Whether an older control plane refused the version-3 summary input as an invalid request (version-2 fallback: delete). */
function isSummaryVersionRejection(error: unknown) {
    return error instanceof MyServersApiError && error.code === "invalid_request";
}

/** Reads the durable owner deletion receipt without dispatching another operation. */
export async function getMyServerDeletionStatus(accessToken: string, serverId: string, callerSignal?: AbortSignal): Promise<MyServerDeletionStatus> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (!uuid.test(serverId)) throw new MyServersApiError("invalid_request", "Invalid deletion reference.");
    const result = await readOwner(accessToken, { operation: "server-deletion-status", input: { serverId } }, ownerReadSignal(accessToken, callerSignal));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new MyServersApiError("invalid_response", "Invalid deletion status.");
    const value = result as Record<string, unknown>;
    const job = value.job;
    if (Object.keys(value).length !== 4 || !["job", "operationState", "serverId", "updatedAt"].every(key => Object.hasOwn(value, key))
        || value.serverId !== serverId || typeof value.operationState !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.operationState)
        || typeof value.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.updatedAt)
        || (job !== null && (!job || typeof job !== "object" || Array.isArray(job)))) {
        throw new MyServersApiError("invalid_response", "Invalid deletion status.");
    }
    if (job !== null) {
        const parsed = job as Record<string, unknown>;
        if (Object.keys(parsed).length !== 5 || !["createdAt", "jobId", "progress", "state", "updatedAt"].every(key => Object.hasOwn(parsed, key))
            || typeof parsed.jobId !== "string" || !uuid.test(parsed.jobId)
            || typeof parsed.state !== "string" || !["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"].includes(parsed.state)
            || typeof parsed.progress !== "string" || parsed.progress.length < 1 || parsed.progress.length > 256 || /[\p{Cc}\p{Cf}]/u.test(parsed.progress)
            || typeof parsed.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed.createdAt)
            || typeof parsed.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed.updatedAt)) {
            throw new MyServersApiError("invalid_response", "Invalid deletion status.");
        }
    }
    return value as MyServerDeletionStatus;
}

export type ManagedStartStatus = {
    serverId: string;
    jobId: string;
    state: "queued" | "running" | "retry-wait" | "succeeded" | "failed" | "cancelled";
    phase: "queued" | "preparing" | "starting" | "verifying" | "ready";
    progress: string;
};

/** Reads one accepted Start without dispatching another operation. */
export async function getMyServerStartStatus(accessToken: string, serverId: string, jobId: string): Promise<ManagedStartStatus> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (!uuid.test(serverId) || !uuid.test(jobId)) throw new MyServersApiError("invalid_request", "Invalid Start reference.");
    const result = await readOwner(accessToken, { operation: "server-start-status", input: { serverId, jobId } },
        ownerReadSignal(accessToken, AbortSignal.timeout(10_000)));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new MyServersApiError("invalid_response", "Invalid Start status.");
    const value = result as Record<string, unknown>;
    if (Object.keys(value).length !== 5 || !["serverId", "jobId", "state", "phase", "progress"].every(key => Object.hasOwn(value, key))
        || value.serverId !== serverId || value.jobId !== jobId
        || !["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"].includes(value.state as string)
        || !["queued", "preparing", "starting", "verifying", "ready"].includes(value.phase as string)
        || (value.phase === "ready") !== (value.state === "succeeded")
        || typeof value.progress !== "string" || value.progress.length < 1 || value.progress.length > 256
        || /[\p{Cc}\p{Cf}]/u.test(value.progress)) throw new MyServersApiError("invalid_response", "Invalid Start status.");
    return value as ManagedStartStatus;
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
    | Extract<OnboardingControlPlaneRequest, { operation: "server-onboarding" }>
    | { operation: "server-deletion-status"; input: { serverId: string } }
    | { operation: "server-start-status"; input: { serverId: string; jobId: string } }, signal: AbortSignal) {
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
        { signal, maximumBytes: request.operation !== "my-servers" ? 65_536 : undefined });
}
