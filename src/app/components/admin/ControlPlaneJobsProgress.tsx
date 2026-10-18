"use client";

import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import type { HostingJobProgress } from "@/app/lib/control-plane/types";
import { JobsReadTable, type JobTableRow } from "./ControlPlaneReadTables";
import { ControlPlaneProgress, isActiveJob, useControlPlaneProgress } from "./ControlPlaneProgress";

async function readJobs(jobs: JobTableRow[], accessToken: string, signal: AbortSignal) {
    const progress = await requestControlPlaneAdmin<HostingJobProgress[]>({ accessToken, signal,
        operation: "jobs-progress", input: { jobIds: jobs.filter(isActiveJob).map(job => job.jobId) } });
    const byId = new Map(progress.map(job => [job.jobId, job]));
    return jobs.map(job => ({ ...job, ...byId.get(job.jobId) }));
}
function active(jobs: JobTableRow[]) { return jobs.some(isActiveJob); }
function fingerprint(jobs: JobTableRow[]) {
    return JSON.stringify(jobs.map(({ jobId, state, progressStage, attemptCount, errorCode }) =>
        [jobId, state, progressStage, attemptCount, errorCode]));
}

export function ControlPlaneJobsProgress({ jobs, allowFailureAcknowledgement }: {
    jobs: JobTableRow[]; allowFailureAcknowledgement: boolean;
}) {
    const progress = useControlPlaneProgress(jobs, readJobs, active, fingerprint);
    return <>
        <ControlPlaneProgress active={progress.active} error={progress.error} />
        {progress.value !== null && <JobsReadTable jobs={progress.value} allowFailureAcknowledgement={allowFailureAcknowledgement} />}
    </>;
}
