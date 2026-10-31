import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { REQUEST_ID } from "./server-visibility-contract.ts";

/** A bare public semantic version ("0.1.6"), the only build identity an owner request may carry. */
export const PUBLIC_VERSION = /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/u;

/** Customers see "0.1.6", never "v0.1.6" or a build id; the registry tag spelling is accepted and stripped. */
export function bareVersion(value: string): string {
    return value.startsWith("v") || value.startsWith("V") ? value.slice(1) : value;
}

/** The bare public version of a bare or "v"-prefixed spelling, or null when it is no public version. */
export function publicVersion(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const bare = bareVersion(value);
    return PUBLIC_VERSION.test(bare) ? bare : null;
}
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const SAFE_CODE = /^[a-z][a-z0-9_-]{0,63}$/u;
const MAXIMUM_OPTIONS = 64;
const MAXIMUM_COPY_LENGTH = 600;

export const BUILD_STEP_IDS = ["queued", "stopping", "backup", "installing", "starting", "verifying"] as const;
export const BUILD_STEP_STATES = ["pending", "active", "done", "skipped", "failed"] as const;
export const BUILD_PHASES = [...BUILD_STEP_IDS, "retry-wait", "rolling-back", "done", "failed", "cancelled"] as const;
const JOB_STATES = ["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"] as const;
const UNAVAILABLE_REASONS = ["nightly-channel", "not-installed", "no-public-builds"] as const;

export type BuildStepId = (typeof BUILD_STEP_IDS)[number];
export type BuildStepState = (typeof BUILD_STEP_STATES)[number];
export type BuildPhase = (typeof BUILD_PHASES)[number];

export type BuildOption = {
    buildId: string;
    version: string;
    isLatest: boolean;
    isInstalled: boolean;
    isPinned: boolean;
    direction: "newer" | "older" | "same";
    saveCompatibility: "verified" | "unverified";
    requiresSaveAcknowledgement: boolean;
};
export type BuildOptions = {
    serverId: string;
    updatedAt: string;
    releaseChannel: "stable" | "nightly";
    selectable: boolean;
    unavailableReason: (typeof UNAVAILABLE_REASONS)[number] | null;
    installedVersion: string | null;
    pinnedVersion: string | null;
    latestVersion: string | null;
    options: BuildOption[];
};
export type BuildChangeJob = {
    jobId: string;
    state: (typeof JOB_STATES)[number];
    initiatedBy: "owner" | "administrator" | "automatic";
    ownerSelected: boolean;
    phase: BuildPhase;
    steps: { id: BuildStepId; state: BuildStepState }[];
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
/** `buildId` is a public version tag, or null for the latest public build; only null clears a rollback pin. */
export type BuildMutation = {
    action: "set-server-build";
    serverId: string;
    buildId: string | null;
    expectedUpdatedAt: string;
    acknowledgeSaveRisk: boolean;
};
/** `jobId` is null when the choice only changed the pin of the version already running. */
export type BuildChangeResult = { outcome: "enqueued" | "existing" | "pinned" | "unpinned"; jobId: string | null; action: "update" };

const invalid = (what: string) => new Error(`Invalid ${what}`);
const isId = (value: unknown): value is string => typeof value === "string" && REQUEST_ID.test(value);
const isTime = (value: unknown): value is string => typeof value === "string" && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
const isCopy = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAXIMUM_COPY_LENGTH && !CONTROL_OR_FORMAT.test(value);
const isVersion = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 64 && !CONTROL_OR_FORMAT.test(value);
const nullable = (check: (value: unknown) => boolean, value: unknown) => value === null || check(value);
const oneOf = <T extends string>(set: readonly T[], value: unknown): value is T => typeof value === "string" && (set as readonly string[]).includes(value);
const count = (value: unknown, maximum: number) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;

export function parseBuildMutation(value: unknown): BuildMutation {
    if (!isRecord(value) || !hasExactKeys(value, ["acknowledgeSaveRisk", "action", "buildId", "expectedUpdatedAt", "serverId"])
        || value.action !== "set-server-build" || !isId(value.serverId) || !isTime(value.expectedUpdatedAt)
        || typeof value.acknowledgeSaveRisk !== "boolean"
        || !(value.buildId === null || publicVersion(value.buildId) !== null)) throw invalid("version change");
    // Either spelling names the same version; the bare one is what is sent on.
    return { ...value, buildId: value.buildId === null ? null : publicVersion(value.buildId) } as BuildMutation;
}

export function parseBuildOptions(value: unknown, serverId: string): BuildOptions {
    if (!isRecord(value) || !hasExactKeys(value, ["installedVersion", "latestVersion", "options", "pinnedVersion", "releaseChannel", "selectable", "serverId", "unavailableReason", "updatedAt"])
        || value.serverId !== serverId || !isTime(value.updatedAt) || (value.releaseChannel !== "stable" && value.releaseChannel !== "nightly")
        || typeof value.selectable !== "boolean"
        || !(value.unavailableReason === null || oneOf(UNAVAILABLE_REASONS, value.unavailableReason))
        || value.selectable !== (value.unavailableReason === null)
        || !nullable(isVersion, value.installedVersion) || !nullable(isVersion, value.pinnedVersion) || !nullable(isVersion, value.latestVersion)
        || !Array.isArray(value.options) || value.options.length > MAXIMUM_OPTIONS) throw invalid("build options");
    const seen = new Set<string>();
    const kept: unknown[] = [];
    for (const option of value.options as unknown[]) {
        // One tag this website cannot select is skipped on its own; it must not hide every other version.
        if (isRecord(option) && typeof option.buildId === "string" && publicVersion(option.buildId) === null) continue;
        if (!isRecord(option) || !hasExactKeys(option, ["buildId", "direction", "isInstalled", "isLatest", "isPinned", "requiresSaveAcknowledgement", "saveCompatibility", "version"])
            || publicVersion(option.buildId) === null || seen.has(publicVersion(option.buildId) as string) || !isVersion(option.version)
            || typeof option.isLatest !== "boolean" || typeof option.isInstalled !== "boolean" || typeof option.isPinned !== "boolean"
            || !oneOf(["newer", "older", "same"] as const, option.direction) || !oneOf(["verified", "unverified"] as const, option.saveCompatibility)
            || typeof option.requiresSaveAcknowledgement !== "boolean") throw invalid("build option");
        const version = publicVersion(option.buildId) as string;
        seen.add(version);
        kept.push({ ...option, buildId: version, version: bareVersion(option.version as string) });
    }
    if (!value.selectable && value.options.length !== 0) throw invalid("build options");
    const show = (version: unknown) => typeof version === "string" ? bareVersion(version) : null;
    return { ...value, installedVersion: show(value.installedVersion), pinnedVersion: show(value.pinnedVersion), latestVersion: show(value.latestVersion), options: kept } as BuildOptions;
}

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
    (job.steps as unknown[]).forEach((step, index) => {
        if (!isRecord(step) || !hasExactKeys(step, ["id", "state"]) || step.id !== BUILD_STEP_IDS[index] || !oneOf(BUILD_STEP_STATES, step.state)) throw invalid("build step");
    });
    const shown = (version: unknown) => typeof version === "string" ? bareVersion(version) : null;
    return { ...value, job: { ...job, targetVersion: shown(job.targetVersion), previousVersion: shown(job.previousVersion) } } as BuildStatus;
}

export function parseBuildChangeResult(value: unknown): BuildChangeResult {
    if (!isRecord(value) || !hasExactKeys(value, ["action", "jobId", "outcome"]) || value.action !== "update"
        || !oneOf(["enqueued", "existing", "pinned", "unpinned"] as const, value.outcome)
        || !(value.jobId === null ? value.outcome === "pinned" || value.outcome === "unpinned" : isId(value.jobId) && (value.outcome === "enqueued" || value.outcome === "existing"))) throw invalid("version change result");
    return value as BuildChangeResult;
}
