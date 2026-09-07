import type {
    HostingPage,
    MyServerBackupJob,
    MyServerBackupStatus,
    MyServerBackupSummary,
    MyServerSummary,
} from "@/app/lib/control-plane/types";

import { parseOnboardingIntent, parseOnboardingSummary, parseOnboardingResult, type OnboardingIntent, type OnboardingResult, type OnboardingSummary } from "../../../../supabase/functions/_shared/server-onboarding-contract";

const MAXIMUM_RESPONSE_BYTES = 8 * 1_048_576;
const MAXIMUM_PAGES = 10;
const BACKUP_PAGE_LIMIT = 50;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_ERROR_CODE = /^[a-z][a-z0-9_-]{0,63}$/u;
const SAFE_STATUS_VALUE = /^[a-z][a-z0-9-]{0,63}$/u;
const BACKUP_TYPES = new Set([
    "daily",
    "weekly",
    "pre-update",
    "pre-import",
    "pre-restore",
    "manual-deletion",
    "role-removal",
    "final-deletion",
    "manual",
]);
const BACKUP_RESTORE_STATES = new Set([
    "available",
    "queued",
    "restoring",
    "restored",
    "failed",
    "expired",
]);
const BACKUP_JOB_STATES = new Set([
    "queued",
    "running",
    "retry-wait",
    "succeeded",
    "failed",
    "cancelled",
]);

export type MyServerOperation = "start" | "stop" | "restart-game";
export type MyServerBackupOperation = "create-backup" | "restore-backup";

export type MyServerOperationResult = {
    outcome: "enqueued" | "existing";
    jobId: string;
    action: MyServerOperation;
};

export type MyServerBackupOperationResult = {
    outcome: "enqueued" | "existing";
    jobId: string;
    action: "backup" | "restore";
};

export class MyServersApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly retryable = false,
    ) {
        super(message);
        this.name = "MyServersApiError";
    }
}

export async function listAllMyServers(accessToken: string): Promise<MyServerSummary[]> {
    const servers: MyServerSummary[] = [];
    const seenIds = new Set<string>();
    let cursor: string | null = null;

    for (let pageIndex = 0; pageIndex < MAXIMUM_PAGES; pageIndex += 1) {
        const result = parseServerPage(await requestMyServers(accessToken, cursor));
        for (const server of result.items) {
            if (seenIds.has(server.serverId)) {
                throw invalidResponse("The server API returned a duplicate server.");
            }
            seenIds.add(server.serverId);
            servers.push(server);
        }
        if (result.nextCursor === null) return servers;
        cursor = result.nextCursor;
    }

    throw new MyServersApiError(
        "response_too_large",
        "The server inventory exceeds the supported page limit.",
    );
}

export async function listAllMyServerBackups(
    accessToken: string,
    serverId: string,
): Promise<MyServerBackupSummary[]> {
    if (!RESOURCE_ID.test(serverId)) {
        throw new MyServersApiError("invalid_request", "The managed server ID is invalid.");
    }
    const backups: MyServerBackupSummary[] = [];
    const seenIds = new Set<string>();
    let cursor: string | null = null;

    for (let pageIndex = 0; pageIndex < MAXIMUM_PAGES; pageIndex += 1) {
        const result = parseBackupPage(
            await requestMyServerBackups(accessToken, serverId, cursor),
        );
        for (const backup of result.items) {
            if (seenIds.has(backup.backupId)) {
                throw invalidResponse("The server API returned a duplicate backup.");
            }
            seenIds.add(backup.backupId);
            backups.push(backup);
        }
        if (result.nextCursor === null) return backups;
        cursor = result.nextCursor;
    }

    throw new MyServersApiError(
        "response_too_large",
        "The backup inventory exceeds the supported page limit.",
    );
}

export async function getMyServerBackupStatus(
    accessToken: string,
    serverId: string,
): Promise<MyServerBackupStatus> {
    if (!RESOURCE_ID.test(serverId)) {
        throw new MyServersApiError("invalid_request", "The managed server ID is invalid.");
    }
    return parseBackupStatus(await requestMyServersApi(accessToken, {
        method: "GET",
        configureEndpoint(endpoint) {
            endpoint.searchParams.set("resource", "backup-status");
            endpoint.searchParams.set("serverId", serverId);
        },
    }), serverId);
}

export async function requestMyServerOperation(
    accessToken: string,
    input: {
        serverId: string;
        action: MyServerOperation;
        expectedUpdatedAt: string;
    },
    requestId: string,
): Promise<MyServerOperationResult> {
    if (!REQUEST_ID.test(requestId)) {
        throw new MyServersApiError("invalid_request", "The server operation request ID is invalid.");
    }
    const result = await requestMyServersApi(accessToken, {
        method: "POST",
        body: JSON.stringify(input),
        requestId,
    });
    if (
        !isRecord(result)
        || !hasExactKeys(result, ["action", "jobId", "outcome"])
        || !["enqueued", "existing"].includes(String(result.outcome))
        || typeof result.jobId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(result.jobId)
        || result.action !== input.action
    ) throw invalidResponse();
    return result as MyServerOperationResult;
}

export async function requestMyServerBackupOperation(
    accessToken: string,
    input:
        | { serverId: string; action: "create-backup"; expectedUpdatedAt: string }
        | { serverId: string; backupId: string; action: "restore-backup"; expectedUpdatedAt: string },
    requestId: string,
): Promise<MyServerBackupOperationResult> {
    if (!REQUEST_ID.test(requestId)) {
        throw new MyServersApiError("invalid_request", "The backup operation request ID is invalid.");
    }
    const result = await requestMyServersApi(accessToken, {
        method: "POST",
        body: JSON.stringify(input),
        requestId,
    });
    const expectedAction = input.action === "create-backup" ? "backup" : "restore";
    if (
        !isRecord(result)
        || !hasExactKeys(result, ["action", "jobId", "outcome"])
        || !["enqueued", "existing"].includes(String(result.outcome))
        || typeof result.jobId !== "string"
        || !RESOURCE_ID.test(result.jobId)
        || result.action !== expectedAction
    ) throw invalidResponse();
    return result as MyServerBackupOperationResult;
}

export async function getServerOnboarding(accessToken: string): Promise<OnboardingSummary> {
    const result = await requestMyServersApi(accessToken, {
        method: "GET",
        configureEndpoint(endpoint) { endpoint.searchParams.set("resource", "onboarding"); },
    });
    try { return parseOnboardingSummary(result); } catch { throw invalidResponse(); }
}

export async function requestServerOnboarding(accessToken: string, intent: OnboardingIntent): Promise<OnboardingResult> {
    let parsed: OnboardingIntent;
    try { parsed = parseOnboardingIntent(intent); } catch {
        throw new MyServersApiError("invalid_request", "The onboarding request is invalid.");
    }
    const { requestId, ...input } = parsed;
    const result = await requestMyServersApi(accessToken, { method: "POST", body: JSON.stringify(input), requestId });
    try { return parseOnboardingResult(result, input); } catch { throw invalidResponse(); }
}

async function requestMyServers(accessToken: string, cursor: string | null): Promise<unknown> {
    return requestMyServersApi(accessToken, {
        method: "GET",
        configureEndpoint(endpoint) {
            endpoint.searchParams.set("limit", "100");
            if (cursor !== null) endpoint.searchParams.set("cursor", cursor);
        },
    });
}

async function requestMyServerBackups(
    accessToken: string,
    serverId: string,
    cursor: string | null,
): Promise<unknown> {
    return requestMyServersApi(accessToken, {
        method: "GET",
        configureEndpoint(endpoint) {
            endpoint.searchParams.set("resource", "backups");
            endpoint.searchParams.set("serverId", serverId);
            endpoint.searchParams.set("limit", String(BACKUP_PAGE_LIMIT));
            if (cursor !== null) endpoint.searchParams.set("cursor", cursor);
        },
    });
}

async function requestMyServersApi(
    accessToken: string,
    request: {
        method: "GET" | "POST";
        body?: string;
        requestId?: string;
        configureEndpoint?: (endpoint: URL) => void;
    },
): Promise<unknown> {
    const { endpoint, publishableKey } = myServersEndpoint();
    request.configureEndpoint?.(endpoint);
    const requestId = request.requestId ?? crypto.randomUUID();

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: request.method,
            headers: {
                accept: "application/json",
                apikey: publishableKey,
                authorization: `Bearer ${accessToken}`,
                ...(request.body === undefined ? {} : { "content-type": "application/json" }),
                "x-request-id": requestId,
            },
            ...(request.body === undefined ? {} : { body: request.body }),
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
        });
    } catch {
        throw new MyServersApiError(
            "server_api_unavailable",
            "The managed-server API could not be reached.",
            true,
        );
    }

    const text = await readBoundedText(response, MAXIMUM_RESPONSE_BYTES);
    let envelope: unknown;
    try {
        envelope = JSON.parse(text);
    } catch {
        throw invalidResponse();
    }
    if (!isRecord(envelope) || envelope.version !== 1 || envelope.requestId !== requestId || typeof envelope.ok !== "boolean") {
        throw invalidResponse();
    }
    if (!envelope.ok) {
        const error = envelope.error;
        if (
            response.ok
            || !hasExactKeys(envelope, ["error", "ok", "requestId", "version"])
            || !isRecord(error)
            || !hasExactKeys(error, ["code", "message", "retryable"])
            || typeof error.code !== "string"
            || !SAFE_ERROR_CODE.test(error.code)
            || typeof error.message !== "string"
            || error.message.length < 1
            || error.message.length > 512
            || /[\p{Cc}\p{Cf}]/u.test(error.message)
            || typeof error.retryable !== "boolean"
        ) throw invalidResponse();
        throw new MyServersApiError(error.code, error.message, error.retryable);
    }
    if (!response.ok || !hasExactKeys(envelope, ["ok", "requestId", "result", "version"])) throw invalidResponse();
    return envelope.result;
}

function myServersEndpoint() {
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!rawUrl || !publishableKey) {
        throw new MyServersApiError("server_api_not_configured", "The managed-server API is not configured.");
    }
    const endpoint = new URL(rawUrl);
    if (endpoint.protocol !== "https:" || endpoint.pathname !== "/" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new MyServersApiError("server_api_not_configured", "The Supabase URL is invalid.");
    }
    if (publishableKey.length < 20 || publishableKey.length > 4_096) {
        throw new MyServersApiError("server_api_not_configured", "The Supabase publishable key is invalid.");
    }
    endpoint.pathname = "/functions/v1/my-servers";
    return { endpoint, publishableKey };
}

function parseServerPage(value: unknown): HostingPage<MyServerSummary> {
    if (!isRecord(value) || !Array.isArray(value.items)) throw invalidResponse();
    if (value.nextCursor !== null && typeof value.nextCursor !== "string") throw invalidResponse();
    return {
        items: value.items as MyServerSummary[],
        nextCursor: value.nextCursor as string | null,
    };
}

function parseBackupPage(value: unknown): HostingPage<MyServerBackupSummary> {
    if (!isRecord(value) || !hasExactKeys(value, ["items", "nextCursor"]) || !Array.isArray(value.items)) {
        throw invalidResponse();
    }
    if (
        value.nextCursor !== null
        && (typeof value.nextCursor !== "string" || value.nextCursor.length < 1 || value.nextCursor.length > 2_048)
    ) throw invalidResponse();
    return {
        items: value.items.map(parseBackup),
        nextCursor: value.nextCursor as string | null,
    };
}

function parseBackup(value: unknown): MyServerBackupSummary {
    if (
        !isRecord(value)
        || !hasExactKeys(value, [
            "backupId",
            "backupType",
            "byteSize",
            "canRestore",
            "createdAt",
            "restoreState",
            "restoredAt",
            "retentionExpiresAt",
        ])
        || typeof value.backupId !== "string"
        || !RESOURCE_ID.test(value.backupId)
        || typeof value.backupType !== "string"
        || !BACKUP_TYPES.has(value.backupType)
        || typeof value.byteSize !== "number"
        || !Number.isSafeInteger(value.byteSize)
        || value.byteSize < 0
        || !isTimestamp(value.createdAt)
        || !isTimestamp(value.retentionExpiresAt)
        || (value.restoredAt !== null && !isTimestamp(value.restoredAt))
        || typeof value.restoreState !== "string"
        || !BACKUP_RESTORE_STATES.has(value.restoreState)
        || typeof value.canRestore !== "boolean"
    ) throw invalidResponse();
    return value as MyServerBackupSummary;
}

function parseBackupStatus(value: unknown, serverId: string): MyServerBackupStatus {
    if (
        !isRecord(value)
        || !hasExactKeys(value, ["job", "observedGameState", "operationState", "serverId", "updatedAt"])
        || value.serverId !== serverId
        || typeof value.operationState !== "string"
        || !SAFE_STATUS_VALUE.test(value.operationState)
        || typeof value.observedGameState !== "string"
        || !SAFE_STATUS_VALUE.test(value.observedGameState)
        || !isTimestamp(value.updatedAt)
    ) throw invalidResponse();
    return {
        serverId,
        operationState: value.operationState,
        observedGameState: value.observedGameState,
        updatedAt: value.updatedAt,
        job: value.job === null ? null : parseBackupJob(value.job),
    };
}

function parseBackupJob(value: unknown): MyServerBackupJob {
    if (
        !isRecord(value)
        || !hasExactKeys(value, ["action", "createdAt", "jobId", "progress", "state", "updatedAt"])
        || typeof value.jobId !== "string"
        || !RESOURCE_ID.test(value.jobId)
        || (value.action !== "backup" && value.action !== "restore")
        || typeof value.state !== "string"
        || !BACKUP_JOB_STATES.has(value.state)
        || typeof value.progress !== "string"
        || value.progress.length < 1
        || value.progress.length > 256
        || /[\p{Cc}\p{Cf}]/u.test(value.progress)
        || !isTimestamp(value.createdAt)
        || !isTimestamp(value.updatedAt)
    ) throw invalidResponse();
    return value as MyServerBackupJob;
}

function isTimestamp(value: unknown): value is string {
    return typeof value === "string"
        && value.length <= 64
        && ISO_TIMESTAMP.test(value)
        && Number.isFinite(Date.parse(value));
}

async function readBoundedText(response: Response, maximumBytes: number) {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
        throw new MyServersApiError("response_too_large", "The server API response was too large.");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
        throw new MyServersApiError("response_too_large", "The server API response was too large.");
    }
    return text;
}

function invalidResponse(message = "The managed-server API returned an invalid response.") {
    return new MyServersApiError("invalid_response", message, true);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
