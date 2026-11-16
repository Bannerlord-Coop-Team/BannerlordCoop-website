import assert from "node:assert/strict";
import test from "node:test";
import type { BuildChangeJob, BuildStatus } from "../../../../supabase/functions/_shared/server-build-contract";
import { nextUpdatePollStep, type UpdateFollow } from "./use-server-update-progress";

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "55555555-5555-4555-8555-555555555555";
const now = 1_000;
const deadline = 2_000;
const idle: UpdateFollow = { kind: "idle" };

// Builds a status read carrying one update job in the given state.
function status(state: BuildChangeJob["state"], id = jobId): BuildStatus {
    return { serverId, job: {
        jobId: id, state, initiatedBy: "automatic", ownerSelected: false, phase: state === "running" ? "installing" : "done",
        steps: [], completedSteps: 3, totalSteps: 6, targetVersion: "0.1.11", previousVersion: "0.1.10", progress: "Installing the update",
        backup: null, rolledBack: false, failureCode: null, failureMessage: null, nextStep: null, attemptCount: 1, maximumAttempts: 3,
        nextRetryAt: null, createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:01:00.000Z", completedAt: null,
    } };
}

test("follows a job that is running when the page loads", () => {
    const read = status("running");
    assert.deepEqual(nextUpdatePollStep({ status: read, follow: idle, now, deadline }), {
        show: { kind: "job", job: read.job }, error: null, refresh: false, poll: "continue", follow: { kind: "following", jobId },
    });
});

test("refreshes once when a followed job ends and keeps it on screen", () => {
    const read = status("succeeded");
    assert.deepEqual(nextUpdatePollStep({ status: read, follow: { kind: "following", jobId }, now, deadline }), {
        show: { kind: "job", job: read.job }, error: null, refresh: true, poll: "stop", follow: { kind: "settled", jobId },
    });
});

test("does not refresh again when the refreshed revision re-reads the settled job", () => {
    const read = status("succeeded");
    assert.deepEqual(nextUpdatePollStep({ status: read, follow: { kind: "settled", jobId }, now, deadline }), {
        show: { kind: "job", job: read.job }, error: null, refresh: false, poll: "stop", follow: { kind: "settled", jobId },
    });
});

for (const state of ["succeeded", "failed", "cancelled"] as const) {
    test(`hides a ${state} job this page never followed and never refreshes`, () => {
        assert.deepEqual(nextUpdatePollStep({ status: status(state), follow: idle, now, deadline }), {
            show: { kind: "hidden" }, error: null, refresh: false, poll: "stop", follow: idle,
        });
    });
}

test("hides a different finished job after settling, without refreshing", () => {
    const other = "66666666-6666-4666-8666-666666666666";
    const step = nextUpdatePollStep({ status: status("failed", other), follow: { kind: "settled", jobId }, now, deadline });
    assert.deepEqual(step, { show: { kind: "hidden" }, error: null, refresh: false, poll: "stop", follow: idle });
});

test("keeps waiting for a requested job while an older finished job is still the latest", () => {
    const step = nextUpdatePollStep({ status: status("succeeded", "66666666-6666-4666-8666-666666666666"), follow: { kind: "following", jobId }, now, deadline });
    assert.deepEqual(step, { show: { kind: "unchanged" }, error: null, refresh: false, poll: "continue", follow: { kind: "following", jobId } });
});

test("reports progress as unavailable when a read fails while following", () => {
    assert.deepEqual(nextUpdatePollStep({ status: null, follow: { kind: "following", jobId }, now, deadline }), {
        show: { kind: "unchanged" }, error: "unavailable", refresh: false, poll: "continue", follow: { kind: "following", jobId },
    });
});

test("stops quietly when a read fails and nothing is followed", () => {
    assert.deepEqual(nextUpdatePollStep({ status: null, follow: idle, now, deadline }), {
        show: { kind: "unchanged" }, error: null, refresh: false, poll: "stop", follow: idle,
    });
});

test("pauses progress checks once the deadline has passed, keeping the running job visible", () => {
    const read = status("running");
    assert.deepEqual(nextUpdatePollStep({ status: read, follow: { kind: "following", jobId }, now: deadline, deadline }), {
        show: { kind: "job", job: read.job }, error: "paused", refresh: false, poll: "stop", follow: { kind: "following", jobId },
    });
    assert.deepEqual(nextUpdatePollStep({ status: null, follow: { kind: "following", jobId }, now: deadline, deadline }), {
        show: { kind: "unchanged" }, error: "paused", refresh: false, poll: "stop", follow: { kind: "following", jobId },
    });
});
