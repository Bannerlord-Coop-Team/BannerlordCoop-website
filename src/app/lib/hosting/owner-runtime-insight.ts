import { isColdSleeping } from "./cold-sleep";
import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { timestamp } from "../../../../supabase/functions/_shared/server-visibility-contract";
import { isModLoadFailure, type ModLoadFailure } from "./mod-load-failure";
import { WAR_SAILS_FAILURE_CODES, type WarSailsFailureCode } from "./war-sails";

export type OwnerFailureCode = "game_crashed_during_load" | "game_unavailable" | "crash_loop_cooldown" | "mod_load_failed" | "operation_failed" | WarSailsFailureCode;
type Recommendation = "review-backups" | "check-console" | "wait" | "contact-support";
export type OwnerStartInsight = {
    action: "start" | "restart-game" | "provision";
    jobId: string;
    state: "queued" | "running" | "retry-wait" | "succeeded" | "failed" | "cancelled";
    phase: "queued" | "preparing" | "starting" | "verifying" | "ready" | "retry-wait" | "failed" | "cancelled";
    progress: string;
    attemptCount: number;
    maximumAttempts: number;
    nextRetryAt: string | null;
    stoppedRetrying: boolean;
    failureCode: OwnerFailureCode | null;
    recommendedAction: Recommendation | null;
};
export type OwnerRuntimeInsight = {
    modLoadFailure?: ModLoadFailure;
    desiredState: "running" | "stopped" | "deleted";
    observedAt: string | null;
    allowedActions: ("start" | "stop" | "restart-game")[];
    crashLoopDetected: boolean | null;
    failureCode: OwnerFailureCode | null;
    recommendedAction: Recommendation | null;
    failureMessage: string | null;
    recommendation: string | null;
    start: OwnerStartInsight | null;
};
export type OwnerRuntimeInsightValidationIssue = { fieldPath: string; reason: string };
export const START_INSIGHT_KEYS = ["action", "jobId", "state", "phase", "progress", "attemptCount", "maximumAttempts", "nextRetryAt", "stoppedRetrying", "failureCode", "recommendedAction"];
const RUNTIME_KEYS = ["desiredState", "observedAt", "allowedActions", "crashLoopDetected", "failureCode", "recommendedAction", "failureMessage", "recommendation", "start"];
const FAILURE_CODES: readonly string[] = ["game_crashed_during_load", "game_unavailable", "crash_loop_cooldown", "mod_load_failed", "operation_failed", ...WAR_SAILS_FAILURE_CODES];
const RECOMMENDATIONS = ["review-backups", "check-console", "wait", "contact-support"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(value);
const failure = (value: unknown) => value === null || FAILURE_CODES.includes(value as string);
const recommendation = (value: unknown) => value === null || RECOMMENDATIONS.includes(value as string);

/** Validates the additive, closed Start projection before any component renders it. */
export function isOwnerStartInsight(value: unknown): value is OwnerStartInsight {
    if (!isRecord(value) || !hasExactKeys(value, START_INSIGHT_KEYS)) return false;
    return typeof value.jobId === "string" && UUID.test(value.jobId)
        && ["start", "restart-game", "provision"].includes(value.action as string)
        && ["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"].includes(value.state as string)
        && ["queued", "preparing", "starting", "verifying", "ready", "retry-wait", "failed", "cancelled"].includes(value.phase as string)
        && text(value.progress) && Number.isSafeInteger(value.attemptCount) && (value.attemptCount as number) >= 0
        && Number.isSafeInteger(value.maximumAttempts) && (value.maximumAttempts as number) >= 1 && (value.maximumAttempts as number) <= 100
        && (value.attemptCount as number) <= (value.maximumAttempts as number)
        && (value.nextRetryAt === null || timestamp(value.nextRetryAt))
        && (value.state === "retry-wait") === (value.nextRetryAt !== null)
        && value.stoppedRetrying === ["failed", "cancelled"].includes(value.state as string)
        && (value.state === "running" ? ["preparing", "starting", "verifying"].includes(value.phase as string)
            : value.phase === (value.state === "succeeded" ? "ready" : value.state))
        && (value.failureCode !== null) === (value.state === "failed")
        && failure(value.failureCode) && recommendation(value.recommendedAction);
}

/** Legacy summaries omit the insight entirely; a present insight must be complete. */
export function isOwnerRuntimeInsight(value: unknown, context?: { operationState: unknown; observedGameState: unknown; subscriptionHold?: unknown }): value is OwnerRuntimeInsight {
    if (!isRecord(value) || !hasExactKeys(value, [...RUNTIME_KEYS, ...(Object.hasOwn(value, "modLoadFailure") ? ["modLoadFailure"] : [])])) return false;
    if (Object.hasOwn(value, "modLoadFailure") && (!isModLoadFailure(value.modLoadFailure)
        || value.desiredState === "deleted" || (isRecord(value.start) && ["queued", "running", "retry-wait", "succeeded"].includes(value.start.state as string)))) return false;
    return ["running", "stopped", "deleted"].includes(value.desiredState as string)
        && (value.observedAt === null || timestamp(value.observedAt))
        && Array.isArray(value.allowedActions) && value.allowedActions.length <= 3
        && new Set(value.allowedActions).size === value.allowedActions.length
        && value.allowedActions.every(action => ["start", "stop", "restart-game"].includes(action))
        && !(value.allowedActions.includes("start") && value.allowedActions.includes("restart-game"))
        && (!(value.allowedActions.includes("start") && value.allowedActions.includes("stop"))
            || (typeof context?.operationState === "string" && isColdSleeping(context.operationState, typeof value.desiredState === "string" ? value.desiredState : undefined)
                && context.observedGameState === "stopped" && !context.subscriptionHold))
        && !(value.crashLoopDetected === true && value.allowedActions.includes("start"))
        && !(value.desiredState === "deleted" && value.allowedActions.length > 0)
        && (value.crashLoopDetected === null || typeof value.crashLoopDetected === "boolean")
        && failure(value.failureCode) && recommendation(value.recommendedAction)
        && (value.failureMessage === null || text(value.failureMessage))
        && (value.recommendation === null || text(value.recommendation))
        && (value.start === null || isOwnerStartInsight(value.start));
}

/** Returns one bounded, field-specific explanation for a rejected insight without exposing its payload. */
export function ownerRuntimeInsightValidationIssue(value: unknown, context?: { operationState: unknown; observedGameState: unknown; subscriptionHold?: unknown }): OwnerRuntimeInsightValidationIssue {
    if (!isRecord(value)) return { fieldPath: "runtimeInsight", reason: "must be an object" };
    const keys = Object.keys(value);
    const expected = [...RUNTIME_KEYS, ...(Object.hasOwn(value, "modLoadFailure") ? ["modLoadFailure"] : [])];
    const unknown = keys.find(key => !expected.includes(key));
    if (unknown) return { fieldPath: ("runtimeInsight." + unknown).slice(0, 128), reason: "unknown field" };
    const missing = expected.find(key => !Object.hasOwn(value, key));
    if (missing) return { fieldPath: "runtimeInsight." + missing, reason: "required field is missing" };
    if (!["running", "stopped", "deleted"].includes(value.desiredState as string)) return { fieldPath: "runtimeInsight.desiredState", reason: "unknown enum value" };
    if (value.observedAt !== null && !timestamp(value.observedAt)) return { fieldPath: "runtimeInsight.observedAt", reason: "invalid timestamp" };
    if (!Array.isArray(value.allowedActions)) return { fieldPath: "runtimeInsight.allowedActions", reason: "must be an array" };
    const badAction = value.allowedActions.find(action => !["start", "stop", "restart-game"].includes(action as string));
    if (badAction !== undefined) return { fieldPath: "runtimeInsight.allowedActions", reason: "unknown enum value" };
    if (value.allowedActions.length > 3 || new Set(value.allowedActions).size !== value.allowedActions.length) return { fieldPath: "runtimeInsight.allowedActions", reason: "duplicate or too many actions" };
    if (value.crashLoopDetected !== null && typeof value.crashLoopDetected !== "boolean") return { fieldPath: "runtimeInsight.crashLoopDetected", reason: "must be boolean or null" };
    if (!failure(value.failureCode)) return { fieldPath: "runtimeInsight.failureCode", reason: "unknown enum value" };
    if (!recommendation(value.recommendedAction)) return { fieldPath: "runtimeInsight.recommendedAction", reason: "unknown enum value" };
    for (const field of ["failureMessage", "recommendation"] as const) {
        if (value[field] !== null && !text(value[field])) return { fieldPath: "runtimeInsight." + field, reason: "must be a bounded string or null" };
    }
    if (Object.hasOwn(value, "modLoadFailure") && !isModLoadFailure(value.modLoadFailure)) return { fieldPath: "runtimeInsight.modLoadFailure", reason: "invalid value" };
    if (value.start !== null) {
        const start = value.start;
        if (!isRecord(start)) return { fieldPath: "runtimeInsight.start", reason: "must be an object or null" };
        if (!hasExactKeys(start, START_INSIGHT_KEYS)) {
            const missingStart = START_INSIGHT_KEYS.find(key => !Object.hasOwn(start, key));
            const unknownStart = Object.keys(start).find(key => !START_INSIGHT_KEYS.includes(key));
            return { fieldPath: ("runtimeInsight.start." + (unknownStart ?? missingStart ?? "shape")).slice(0, 128), reason: unknownStart ? "unknown field" : "required field is missing" };
        }
        if (!text(start.progress)) return { fieldPath: "runtimeInsight.start.progress", reason: "must be a bounded string" };
        if (!Number.isSafeInteger(start.maximumAttempts) || (start.maximumAttempts as number) < 1 || (start.maximumAttempts as number) > 100) return { fieldPath: "runtimeInsight.start.maximumAttempts", reason: "must be an integer from 1 to 100" };
        if (!Number.isSafeInteger(start.attemptCount) || (start.attemptCount as number) < 0) return { fieldPath: "runtimeInsight.start.attemptCount", reason: "must be a non-negative safe integer" };
        if ((start.attemptCount as number) > (start.maximumAttempts as number)) return { fieldPath: "runtimeInsight.start.attemptCount", reason: "must be less than or equal to maximumAttempts" };
        if (!["start", "restart-game", "provision"].includes(start.action as string)) return { fieldPath: "runtimeInsight.start.action", reason: "unknown enum value" };
        if (!["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"].includes(start.state as string)) return { fieldPath: "runtimeInsight.start.state", reason: "unknown enum value" };
    }
    if (isOwnerRuntimeInsight(value, context)) return { fieldPath: "runtimeInsight", reason: "unknown validation failure" };
    return { fieldPath: "runtimeInsight", reason: "failed the strict contract" };
}
