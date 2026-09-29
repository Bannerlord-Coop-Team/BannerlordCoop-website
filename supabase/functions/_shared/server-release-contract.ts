import { exactKeys, isRecord, REQUEST_ID } from "./server-visibility-contract.ts";

export type ReleaseChannel = "stable" | "nightly";
export type ReleaseMutation = { action: "set-release-channel"; serverId: string; releaseChannel: ReleaseChannel; expectedUpdatedAt: string };
export type ReleaseStatus = { serverId: string; releaseChannel: ReleaseChannel; job: null | {
    jobId: string; state: "queued" | "running" | "retry-wait" | "succeeded" | "failed" | "cancelled"; progress: string;
} };
export function parseReleaseMutation(value: unknown): ReleaseMutation {
    if (!isRecord(value) || !exactKeys(value, ["action", "serverId", "releaseChannel", "expectedUpdatedAt"])
        || value.action !== "set-release-channel" || typeof value.serverId !== "string" || !REQUEST_ID.test(value.serverId)
        || (value.releaseChannel !== "stable" && value.releaseChannel !== "nightly")
        || typeof value.expectedUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.expectedUpdatedAt)
        || !Number.isFinite(Date.parse(value.expectedUpdatedAt))) throw new Error("Invalid release change");
    return value as ReleaseMutation;
}
export function parseReleaseStatus(value: unknown, serverId: string): ReleaseStatus {
    if (!isRecord(value) || !exactKeys(value, ["serverId", "releaseChannel", "job"]) || value.serverId !== serverId
        || (value.releaseChannel !== "stable" && value.releaseChannel !== "nightly")) throw new Error("Invalid release status");
    const job = value.job;
    if (job !== null && (!isRecord(job) || !exactKeys(job, ["jobId", "state", "progress"])
        || typeof job.jobId !== "string" || !REQUEST_ID.test(job.jobId)
        || !["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"].includes(String(job.state))
        || typeof job.progress !== "string" || job.progress.length > 300 || /[\p{Cc}\p{Cf}]/u.test(job.progress))) throw new Error("Invalid update job");
    return value as ReleaseStatus;
}
