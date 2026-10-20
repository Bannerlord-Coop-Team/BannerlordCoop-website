import "server-only";
import { isIP } from "node:net";
import type { MyServerMove, MyServerNotice, MyServerSummary } from "@/app/lib/control-plane/types";
import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { isRegionKey } from "../../../../supabase/functions/_shared/hosting-regions";
import { REQUEST_ID, timestamp } from "../../../../supabase/functions/_shared/server-visibility-contract";
import { HOSTING_MAINTENANCE_SLOTS, type MaintenanceSlot } from "../../../../supabase/functions/_shared/server-settings-contract";
import { controlPlaneEndpoint } from "@/app/lib/control-plane/origin";
import { listAllMyServers as collectServers, MyServersApiError, readMyServersResponse, type MyServerDeletionStatus } from "./my-servers";
import { onboardingSummaryRequest, parseOnboardingSummary, type OnboardingSummaryRequest } from "../../../../supabase/functions/_shared/server-onboarding-contract";
import { isModId } from "../../../../supabase/functions/_shared/server-mods-contract";
import { SERVER_MOVE_STATES, SERVER_MOVE_STEPS } from "./server-move";
import { isJoinAddress } from "./connection-address";

/** Reads owner inventory directly; Oracle rechecks the current session and durable access on every page. */
export async function listAllMyServers(accessToken: string, callerSignal?: AbortSignal) {
    const signal = ownerReadSignal(accessToken, callerSignal);
    return collectServers(accessToken, signal, (token, cursor) => readOwner(token,
        { operation: "my-servers", input: { cursor, limit: 100 } }, signal));
}

/** Reads one freshly authorized summary without collecting inventory or hydrating a dashboard. */
export async function getMyServerSummary(accessToken: string, serverId: string, callerSignal?: AbortSignal): Promise<MyServerSummary> {
    if (!REQUEST_ID.test(serverId)) throw new MyServersApiError("invalid_request", "Invalid managed server ID.");
    const value = await readOwner(accessToken, { operation: "server-summary", input: { serverId } }, ownerReadSignal(accessToken, callerSignal));
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "displayName", "accessRole", "friendlyRegion", "operationState",
        "observedGameState", "releaseChannel", "maintenanceSlot", "timezone", "visibility", "connectionIp", "gamePorts", "updatedAt"])
        || value.serverId !== serverId || !timestamp(value.updatedAt)
        || typeof value.displayName !== "string" || value.displayName.length < 1 || value.displayName.length > 48 || /[\p{Cc}]/u.test(value.displayName)
        || !["owner", "manager", "support", "admin"].includes(value.accessRole as string)
        || !isRegionKey(value.friendlyRegion)
        || typeof value.operationState !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.operationState)
        || !["running", "stopped", "starting", "stopping", "unknown", "awaiting-save", "failed", "degraded"].includes(value.observedGameState as string)
        || !["stable", "nightly"].includes(value.releaseChannel as string)
        || !HOSTING_MAINTENANCE_SLOTS.includes(value.maintenanceSlot as MaintenanceSlot)
        || typeof value.timezone !== "string" || value.timezone.length < 1 || value.timezone.length > 100 || /[\p{Cc}\p{Cf}]/u.test(value.timezone)
        || !["private", "public"].includes(value.visibility as string)
        || (value.connectionIp !== null && (typeof value.connectionIp !== "string" || isIP(value.connectionIp) === 0))
        || !Array.isArray(value.gamePorts) || value.gamePorts.length > 32
        || value.gamePorts.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) {
        throw new MyServersApiError("invalid_response", "The managed-server API returned an invalid summary.", true);
    }
    return value as MyServerSummary;
}

/** Called after website account synchronization; eligibility and capacity are freshly checked by Oracle. */
export async function getServerOnboarding(accessToken: string, callerSignal?: AbortSignal) {
    const result = await readOwner(accessToken, onboardingSummaryRequest(), ownerReadSignal(accessToken, callerSignal));
    try { return parseOnboardingSummary(result); } catch {
        throw new MyServersApiError("invalid_response", "The managed-server API returned an invalid response.", true);
    }
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

/** The control plane's diagnosis of a Start that failed because an enabled mod did not load. */
export type ModLoadFailure = { modId: string; reason: "missing-assembly" | "load-error" | "missing-dll"; assembly?: string };

export type ManagedStartStatus = {
    serverId: string;
    jobId: string;
    state: "queued" | "running" | "retry-wait" | "succeeded" | "failed" | "cancelled";
    phase: "queued" | "preparing" | "starting" | "verifying" | "ready";
    progress: string;
    /** Only on a failed Start whose enabled mod did not load; `progress` then holds the control plane's English copy. */
    modLoadFailure?: ModLoadFailure;
};

const START_STATUS_KEYS = ["serverId", "jobId", "state", "phase", "progress"];
const ASSEMBLY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;

/** Whether a value is the closed mod-load diagnosis: an assembly name exactly when the reason is a missing assembly. */
function isModLoadFailure(value: unknown): value is ModLoadFailure {
    if (!isRecord(value) || !isModId(value.modId)) return false;
    if (value.reason === "missing-assembly") return hasExactKeys(value, ["modId", "reason", "assembly"]) && typeof value.assembly === "string" && ASSEMBLY_NAME.test(value.assembly);
    return (value.reason === "load-error" || value.reason === "missing-dll") && hasExactKeys(value, ["modId", "reason"]);
}

/** Reads one accepted Start without dispatching another operation. */
export async function getMyServerStartStatus(accessToken: string, serverId: string, jobId: string): Promise<ManagedStartStatus> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (!uuid.test(serverId) || !uuid.test(jobId)) throw new MyServersApiError("invalid_request", "Invalid Start reference.");
    const result = await readOwner(accessToken, { operation: "server-start-status", input: { serverId, jobId } },
        ownerReadSignal(accessToken, AbortSignal.timeout(10_000)));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new MyServersApiError("invalid_response", "Invalid Start status.");
    const value = result as Record<string, unknown>;
    const diagnosed = Object.hasOwn(value, "modLoadFailure");
    if (!hasExactKeys(value, diagnosed ? [...START_STATUS_KEYS, "modLoadFailure"] : START_STATUS_KEYS)
        || (diagnosed && (value.state !== "failed" || !isModLoadFailure(value.modLoadFailure)))
        || value.serverId !== serverId || value.jobId !== jobId
        || !["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"].includes(value.state as string)
        || !["queued", "preparing", "starting", "verifying", "ready"].includes(value.phase as string)
        || (value.phase === "ready") !== (value.state === "succeeded")
        || typeof value.progress !== "string" || value.progress.length < 1 || value.progress.length > 256
        || /[\p{Cc}\p{Cf}]/u.test(value.progress)) throw new MyServersApiError("invalid_response", "Invalid Start status.");
    return value as ManagedStartStatus;
}

/** CPU and memory of one running server's own allocation (its cgroup), not the whole VPS it shares. */
export type ManagedServerResources = {
    observedAt: string;
    cpuVcpus: number;
    cpuLimitVcpus: number;
    memoryUsedBytes: number;
    memoryLimitBytes: number;
};

/** Reads current usage, or null when the server is not running or its runner could not be sampled. */
export async function getMyServerResources(accessToken: string, serverId: string): Promise<ManagedServerResources | null> {
    if (!REQUEST_ID.test(serverId)) throw new MyServersApiError("invalid_request", "Invalid managed server ID.");
    const value = await readOwner(accessToken, { operation: "server-resources", input: { serverId } },
        ownerReadSignal(accessToken, AbortSignal.timeout(10_000)));
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "resources"]) || value.serverId !== serverId) {
        throw new MyServersApiError("invalid_response", "Invalid server resources.");
    }
    if (value.resources === null) return null;
    const resources = value.resources;
    const finite = (number: unknown, maximum: number) => typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= maximum;
    if (!isRecord(resources) || !hasExactKeys(resources, ["observedAt", "cpuVcpus", "cpuLimitVcpus", "memoryUsedBytes", "memoryLimitBytes"])
        || typeof resources.observedAt !== "string" || Number.isNaN(Date.parse(resources.observedAt))
        || !finite(resources.cpuVcpus, 1_024) || !finite(resources.cpuLimitVcpus, 1_024) || resources.cpuLimitVcpus === 0
        || !Number.isSafeInteger(resources.memoryUsedBytes) || !Number.isSafeInteger(resources.memoryLimitBytes)
        || (resources.memoryUsedBytes as number) < 0 || (resources.memoryLimitBytes as number) < 1
        || (resources.memoryUsedBytes as number) > (resources.memoryLimitBytes as number)) {
        throw new MyServersApiError("invalid_response", "Invalid server resources.");
    }
    return resources as ManagedServerResources;
}

const NOTICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NOTICE_KINDS = new Set(["administrator", "placement-scheduled", "placement-completed"]);
const NOTICE_PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;

/** Reads the undismissed notices this viewer sees on one server's page, newest first (at most 10). */
export async function getMyServerNotices(accessToken: string, serverId: string, callerSignal?: AbortSignal): Promise<MyServerNotice[]> {
    if (!REQUEST_ID.test(serverId)) throw new MyServersApiError("invalid_request", "Invalid managed server ID.");
    const value = await readOwner(accessToken, { operation: "server-notices", input: { serverId } }, ownerReadSignal(accessToken, callerSignal));
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "notices"]) || value.serverId !== serverId
        || !Array.isArray(value.notices) || value.notices.length > 10 || !value.notices.every(isMyServerNotice)
        || new Set(value.notices.map(notice => notice.noticeId)).size !== value.notices.length) {
        throw new MyServersApiError("invalid_response", "The managed-server API returned invalid server notices.", true);
    }
    return value.notices;
}

// Notice text is plain and rendered as text: one title line, a message that may keep line breaks and tabs.
function isMyServerNotice(value: unknown): value is MyServerNotice {
    if (!isRecord(value) || !hasExactKeys(value, ["noticeId", "kind", "severity", "title", "body", "parameters", "createdAt", "expiresAt"])) return false;
    const parameters = value.parameters;
    return typeof value.noticeId === "string" && NOTICE_ID.test(value.noticeId)
        && NOTICE_KINDS.has(value.kind as string) && (value.severity === "info" || value.severity === "warning")
        && typeof value.title === "string" && value.title.length >= 1 && value.title.length <= 120 && !hasNoticeControlCharacter(value.title, false)
        && typeof value.body === "string" && value.body.length >= 1 && value.body.length <= 2_000 && !hasNoticeControlCharacter(value.body, true)
        && isRecord(parameters) && Object.keys(parameters).length <= 16 && Object.entries(parameters).every(([name, parameter]) => NOTICE_PARAMETER_NAME.test(name)
            && (parameter === null || typeof parameter === "boolean" || (typeof parameter === "number" && Number.isFinite(parameter))
                || (typeof parameter === "string" && parameter.length <= 256 && !hasNoticeControlCharacter(parameter, false))))
        && timestamp(value.createdAt) && (value.expiresAt === null || timestamp(value.expiresAt));
}

/** The control plane's rule, so every notice it stores is readable: no C0 control or DEL, except tab and newline in a message. */
function hasNoticeControlCharacter(value: string, allowWhitespace: boolean) {
    for (const character of value) {
        const code = character.codePointAt(0)!;
        if (code === 127 || (code < 32 && !(allowWhitespace && (code === 9 || code === 10)))) return true;
    }
    return false;
}

/**
 * Reads this server's announced, running or recently finished move to another machine, or null when there
 * is none. Older control planes reject the operation, which callers treat the same as no move.
 */
export async function getMyServerMoveStatus(accessToken: string, serverId: string, callerSignal?: AbortSignal): Promise<MyServerMove | null> {
    if (!REQUEST_ID.test(serverId)) throw new MyServersApiError("invalid_request", "Invalid managed server ID.");
    const value = await readOwner(accessToken, { operation: "server-move-status", input: { serverId } }, ownerReadSignal(accessToken, callerSignal));
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "move"]) || value.serverId !== serverId
        || (value.move !== null && !isMyServerMove(value.move))) {
        throw new MyServersApiError("invalid_response", "The managed-server API returned an invalid move status.", true);
    }
    return value.move;
}

type MoveField = Exclude<keyof MyServerMove, "state">;
/** Which fields each state carries, exactly as the control plane sends them: required, optional (null allowed) or null. */
const MOVE_FIELDS: Record<MyServerMove["state"], Record<MoveField, "required" | "optional" | "null">> = {
    scheduled: { scheduledAt: "required", startedAt: "null", completedAt: "null", step: "null", address: "null", stayedOnOriginal: "null" },
    starting: { scheduledAt: "required", startedAt: "null", completedAt: "null", step: "null", address: "null", stayedOnOriginal: "null" },
    moving: { scheduledAt: "optional", startedAt: "required", completedAt: "null", step: "optional", address: "null", stayedOnOriginal: "null" },
    returning: { scheduledAt: "optional", startedAt: "required", completedAt: "null", step: "null", address: "null", stayedOnOriginal: "null" },
    moved: { scheduledAt: "null", startedAt: "required", completedAt: "required", step: "null", address: "optional", stayedOnOriginal: "null" },
    failed: { scheduledAt: "null", startedAt: "required", completedAt: "required", step: "null", address: "null", stayedOnOriginal: "required" },
};
const MOVE_FIELD_VALUES: Record<MoveField, (value: unknown) => boolean> = {
    scheduledAt: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    step: (value) => SERVER_MOVE_STEPS.includes(value as NonNullable<MyServerMove["step"]>),
    address: isJoinAddress,
    stayedOnOriginal: (value) => typeof value === "boolean",
};

// Each state carries only its own fields, so the page never shows a time, step, address or outcome out of place.
function isMyServerMove(value: unknown): value is MyServerMove {
    if (!isRecord(value) || !hasExactKeys(value, ["state", ...Object.keys(MOVE_FIELD_VALUES)])) return false;
    if (!SERVER_MOVE_STATES.includes(value.state as MyServerMove["state"])) return false;
    return Object.entries(MOVE_FIELDS[value.state as MyServerMove["state"]]).every(([field, presence]) => value[field] === null
        ? presence !== "required"
        : presence !== "null" && MOVE_FIELD_VALUES[field as MoveField](value[field]));
}


// Validates the owner token and bounds a read by the caller's signal and a 30-second timeout.
function ownerReadSignal(accessToken: string, callerSignal?: AbortSignal) {
    if (accessToken.length < 20 || accessToken.length > 8_192) {
        throw new MyServersApiError("invalid_request", "The managed-server read request is invalid.");
    }
    return callerSignal
        ? AbortSignal.any([callerSignal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
}

// Posts one owner read to the control plane and returns its result after checking the redirect, content type and length.
async function readOwner(accessToken: string, request:
    | { operation: "my-servers"; input: { cursor: string | null; limit: 100 } }
    | { operation: "server-summary"; input: { serverId: string } }
    | OnboardingSummaryRequest
    | { operation: "server-deletion-status"; input: { serverId: string } }
    | { operation: "server-start-status"; input: { serverId: string; jobId: string } }
    | { operation: "server-resources"; input: { serverId: string } }
    | { operation: "server-notices"; input: { serverId: string } }
    | { operation: "server-move-status"; input: { serverId: string } }, signal: AbortSignal) {
    const requestId = crypto.randomUUID();
    let response: Response;
    try {
        signal.throwIfAborted();
        response = await fetch(controlPlaneEndpoint("/v1/user/control-plane"), {
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
