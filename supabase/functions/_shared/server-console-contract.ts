export const MAXIMUM_CONSOLE_COMMAND_LENGTH = 4096;
export const MAXIMUM_CONSOLE_OUTPUT_BYTES = 262144;
export const MAXIMUM_CONSOLE_RESPONSE_BYTES = 1638400;

export type ConsoleSubmission = { serverId: string; command: string; expectedUpdatedAt: string };
export type ConsoleReference = { serverId: string; jobId: string; commandRequestId: string };
export type ConsoleReceipt = { outcome: "enqueued" | "existing"; jobId: string };
export type ConsoleResult = { status: "pending" } | { status: "cancelled" }
    | { status: "failed"; errorCode: string }
    | { status: "succeeded"; output: string; outputTruncated: boolean; outputWithheld: boolean; completedAt: string };

/** Checks UUID identities before a command or result crosses the owner API boundary. */
export function requireConsoleUuid(value: unknown): asserts value is string {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new Error("Invalid console request ID");
}

/** Rejects unexpected transport fields rather than forwarding them upstream. */
function record(value: unknown, keys: string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid console request");
    if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new Error("Invalid console fields");
    return value as Record<string, unknown>;
}

/** Validates the exact UTC timestamp used by the server's stale-state guard. */
function timestamp(value: unknown): asserts value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid console timestamp");
}

/** Matches ControlPlane normalization and permits only one coop.* STDIN command. */
export function parseConsoleSubmission(value: unknown): ConsoleSubmission {
    const input = record(value, ["serverId", "command", "expectedUpdatedAt"]);
    requireConsoleUuid(input.serverId);
    timestamp(input.expectedUpdatedAt);
    if (typeof input.command !== "string") throw new Error("Enter a coop.* command");
    const command = input.command.normalize("NFKC").trim();
    if (command.length > MAXIMUM_CONSOLE_COMMAND_LENGTH || !/^coop\.[A-Za-z\d_.-]+$/u.test(command.split(/\s+/u, 1)[0]) || /[\p{Cc}\p{Zl}\p{Zp};&|`]/u.test(command)) throw new Error("Enter one coop.* command without control characters or command separators");
    return { serverId: input.serverId, command, expectedUpdatedAt: input.expectedUpdatedAt };
}

/** Binds reads and acknowledgements to the original server, job and enqueue request. */
export function parseConsoleReference(value: unknown): ConsoleReference {
    const input = record(value, ["serverId", "jobId", "commandRequestId"]);
    requireConsoleUuid(input.serverId); requireConsoleUuid(input.jobId); requireConsoleUuid(input.commandRequestId);
    return { serverId: input.serverId, jobId: input.jobId, commandRequestId: input.commandRequestId };
}

/** Accepts only a durable job receipt, never a speculative execution success. */
export function parseConsoleReceipt(value: unknown): ConsoleReceipt {
    const result = record(value, ["outcome", "jobId"]);
    requireConsoleUuid(result.jobId);
    if (result.outcome !== "enqueued" && result.outcome !== "existing") throw new Error("Invalid console outcome");
    return { outcome: result.outcome, jobId: result.jobId };
}

/** Validates the acknowledgement without treating it as command execution evidence. */
export function parseConsoleAcknowledgement(value: unknown): { acknowledged: boolean } {
    const result = record(value, ["acknowledged"]);
    if (typeof result.acknowledged !== "boolean") throw new Error("Invalid console acknowledgement");
    return { acknowledged: result.acknowledged };
}

/** Validates bounded plaintext output and the terminal states returned by ControlPlane. */
export function parseConsoleResult(value: unknown): ConsoleResult {
    if (!value || typeof value !== "object" || !("status" in value)) throw new Error("Invalid console result");
    if (value.status === "pending" || value.status === "cancelled") {
        record(value, ["status"]);
        return { status: value.status };
    }
    if (value.status === "failed") {
        const result = record(value, ["status", "errorCode"]);
        if (typeof result.errorCode !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/u.test(result.errorCode)) throw new Error("Invalid console error");
        return { status: "failed", errorCode: result.errorCode };
    }
    if (value.status !== "succeeded") throw new Error("Invalid console status");
    const result = record(value, ["status", "output", "outputTruncated", "outputWithheld", "completedAt"]);
    if (typeof result.output !== "string" || new TextEncoder().encode(result.output).byteLength > MAXIMUM_CONSOLE_OUTPUT_BYTES
        || typeof result.outputTruncated !== "boolean" || typeof result.outputWithheld !== "boolean") throw new Error("Invalid console output");
    timestamp(result.completedAt);
    return { status: "succeeded", output: result.output, outputTruncated: result.outputTruncated, outputWithheld: result.outputWithheld, completedAt: result.completedAt };
}
