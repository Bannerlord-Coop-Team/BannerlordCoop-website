import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { timestamp } from "../../../../supabase/functions/_shared/server-visibility-contract";

export type OwnerFailureCode = "game_crashed_during_load" | "game_unavailable" | "crash_loop_cooldown" | "mod_load_failed" | "operation_failed";
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
    desiredState: string;
    observedAt: string | null;
    allowedActions: ("start" | "stop" | "restart-game")[];
    crashLoopDetected: boolean | null;
    failureCode: OwnerFailureCode | null;
    recommendedAction: Recommendation | null;
    failureMessage: string | null;
    recommendation: string | null;
    start: OwnerStartInsight | null;
};
export const START_INSIGHT_KEYS = ["action", "jobId", "state", "phase", "progress", "attemptCount", "maximumAttempts", "nextRetryAt", "stoppedRetrying", "failureCode", "recommendedAction"];
const RUNTIME_KEYS = ["desiredState", "observedAt", "allowedActions", "crashLoopDetected", "failureCode", "recommendedAction", "failureMessage", "recommendation", "start"];
const FAILURE_CODES = ["game_crashed_during_load", "game_unavailable", "crash_loop_cooldown", "mod_load_failed", "operation_failed"];
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
export function isOwnerRuntimeInsight(value: unknown): value is OwnerRuntimeInsight {
    if (!isRecord(value) || !hasExactKeys(value, RUNTIME_KEYS)) return false;
    return ["running", "stopped", "deleted"].includes(value.desiredState as string)
        && (value.observedAt === null || timestamp(value.observedAt))
        && Array.isArray(value.allowedActions) && value.allowedActions.length <= 3
        && new Set(value.allowedActions).size === value.allowedActions.length
        && value.allowedActions.every(action => ["start", "stop", "restart-game"].includes(action))
        && !(value.allowedActions.includes("start") && (value.allowedActions.includes("stop") || value.allowedActions.includes("restart-game")))
        && !(value.crashLoopDetected === true && value.allowedActions.includes("start"))
        && !(value.desiredState === "deleted" && value.allowedActions.length > 0)
        && (value.crashLoopDetected === null || typeof value.crashLoopDetected === "boolean")
        && failure(value.failureCode) && recommendation(value.recommendedAction)
        && (value.failureMessage === null || text(value.failureMessage))
        && (value.recommendation === null || text(value.recommendation))
        && (value.start === null || isOwnerStartInsight(value.start));
}
