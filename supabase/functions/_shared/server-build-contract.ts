import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { REQUEST_ID } from "./server-visibility-contract.ts";

// Owners no longer choose a version (ControlPlane #1125 retired `server-build-options` and `set-server-build`):
// every server runs its release channel's current build. Only update progress is read here.

/** Customers see "0.1.6", never "v0.1.6" or a build id; the registry tag spelling is accepted and stripped. */
export function bareVersion(value: string): string {
    return value.startsWith("v") || value.startsWith("V") ? value.slice(1) : value;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const SAFE_CODE = /^[a-z][a-z0-9_-]{0,63}$/u;
const MAXIMUM_COPY_LENGTH = 600;

export const BUILD_STEP_IDS = ["queued", "stopping", "backup", "installing", "starting", "verifying"] as const;
export const BUILD_STEP_STATES = ["pending", "active", "done", "skipped", "failed"] as const;
export const BUILD_PHASES = [...BUILD_STEP_IDS, "retry-wait", "rolling-back", "done", "failed", "cancelled"] as const;
const JOB_STATES = ["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"] as const;

export type BuildStepId = (typeof BUILD_STEP_IDS)[number];
export type BuildStepState = (typeof BUILD_STEP_STATES)[number];
export type BuildPhase = (typeof BUILD_PHASES)[number];

export type BuildChangeJob = {
    jobId: string;
    state: (typeof JOB_STATES)[number];
    initiatedBy: "owner" | "administrator" | "automatic";
    ownerSelected: boolean;
    phase: BuildPhase;
    /** Durable receipt times are additive so older control planes remain readable. */
    steps: { id: BuildStepId; state: BuildStepState; startedAt?: string | null; completedAt?: string | null }[];
    completedSteps: number;
    totalSteps: number;
    targetVersion: string | null;
    previousVersion: string | null;
    progress: string;
    backup: { backupId: string } | null;
    rolledBack: boolean;
    failureCode: string | null;
    failureMessage: string | null;
    nextStep: string | null;
    attemptCount: number;
    maximumAttempts: number;
    nextRetryAt: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
};
export type BuildStatus = { serverId: string; job: BuildChangeJob | null };

const invalid = (what: string) => new Error(`Invalid ${what}`);
const isId = (value: unknown): value is string => typeof value === "string" && REQUEST_ID.test(value);
const isTime = (value: unknown): value is string => typeof value === "string" && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
const isCopy = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAXIMUM_COPY_LENGTH && !CONTROL_OR_FORMAT.test(value);
const isVersion = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 64 && !CONTROL_OR_FORMAT.test(value);
const nullable = (check: (value: unknown) => boolean, value: unknown) => value === null || check(value);
const oneOf = <T extends string>(set: readonly T[], value: unknown): value is T => typeof value === "string" && (set as readonly string[]).includes(value);
const count = (value: unknown, maximum: number) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;

/** Validates the owner's `server-build-status` answer: the current or latest update job as fixed steps. */
export function parseBuildStatus(value: unknown, serverId: string): BuildStatus {
    if (!isRecord(value) || !hasExactKeys(value, ["job", "serverId"]) || value.serverId !== serverId) throw invalid("build status");
    const job = value.job;
    if (job === null) return value as BuildStatus;
    if (!isRecord(job) || !hasExactKeys(job, ["attemptCount", "backup", "completedAt", "completedSteps", "createdAt", "failureCode", "failureMessage", "initiatedBy", "jobId", "maximumAttempts", "nextRetryAt", "nextStep", "ownerSelected", "phase", "previousVersion", "progress", "rolledBack", "state", "steps", "targetVersion", "totalSteps", "updatedAt"])
        || !isId(job.jobId) || !oneOf(JOB_STATES, job.state) || !oneOf(["owner", "administrator", "automatic"] as const, job.initiatedBy)
        || typeof job.ownerSelected !== "boolean" || !oneOf(BUILD_PHASES, job.phase) || !count(job.completedSteps, 16) || !count(job.totalSteps, 16)
        || (job.totalSteps as number) < 1 || (job.completedSteps as number) > (job.totalSteps as number)
        || !nullable(isVersion, job.targetVersion) || !nullable(isVersion, job.previousVersion) || !isCopy(job.progress)
        || typeof job.rolledBack !== "boolean" || !(job.failureCode === null || (typeof job.failureCode === "string" && SAFE_CODE.test(job.failureCode)))
        || !nullable(isCopy, job.failureMessage) || !nullable(isCopy, job.nextStep)
        || !count(job.attemptCount, 1_000) || !count(job.maximumAttempts, 1_000)
        || !nullable(isTime, job.nextRetryAt) || !isTime(job.createdAt) || !isTime(job.updatedAt) || !nullable(isTime, job.completedAt)
        || !(job.backup === null || (isRecord(job.backup) && hasExactKeys(job.backup, ["backupId"]) && isId(job.backup.backupId)))
        || !Array.isArray(job.steps) || job.steps.length !== BUILD_STEP_IDS.length) throw invalid("build change");
    const steps = (job.steps as unknown[]).map((step, index) => {
        if (!isRecord(step) || !(hasExactKeys(step, ["id", "state"])
            || hasExactKeys(step, ["completedAt", "id", "startedAt", "state"]))
            || step.id !== BUILD_STEP_IDS[index] || !oneOf(BUILD_STEP_STATES, step.state)) throw invalid("build step");
        const startedAt = step.startedAt === undefined ? null : step.startedAt;
        const completedAt = step.completedAt === undefined ? null : step.completedAt;
        if (!nullable(isTime, startedAt) || !nullable(isTime, completedAt)) throw invalid("build step timestamp");
        return { ...step, startedAt, completedAt };
    });
    const shown = (version: unknown) => typeof version === "string" ? bareVersion(version) : null;
    return { ...value, job: { ...job, steps, targetVersion: shown(job.targetVersion), previousVersion: shown(job.previousVersion) } } as BuildStatus;
}
