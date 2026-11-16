import assert from "node:assert/strict";
import test from "node:test";
import type { BuildUpdateJob, BuildStatus } from "../../../../supabase/functions/_shared/server-build-contract";
import { INITIAL_UPDATE_PROGRESS_STATE, nextUpdatePollStep, updateProgressReducer, type UpdateFollow, type UpdateProgressState } from "./use-server-update-progress";
import { updateJob, updateJobInState } from "./ServerUpdateProgress.test-utils";

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = updateJob().jobId;
const otherJobId = "66666666-6666-4666-8666-666666666666";
const now = 1_000;
const deadline = 2_000;
const idle: UpdateFollow = { kind: "idle" };

// Wraps one update job in the given state as the server's status read.
function status(state: BuildUpdateJob["state"], id = jobId): BuildStatus {
    return { serverId, job: updateJobInState(state, { jobId: id }) };
}

for (const state of ["queued", "running", "retry-wait"] as const) {
    test(`follows a ${state} job that is in progress when the page loads`, () => {
        const read = status(state);
        assert.deepEqual(nextUpdatePollStep({ status: read, follow: idle, now, deadline }), {
            show: { kind: "job", job: read.job }, error: null, refresh: false, poll: "continue", follow: { kind: "following", jobId },
        });
    });
}

test("switches the follow to a different in-progress job without refreshing", () => {
    // Any in-progress job is the server's current update, so it replaces the followed one; its end refreshes instead.
    const read = status("running", otherJobId);
    assert.deepEqual(nextUpdatePollStep({ status: read, follow: { kind: "following", jobId }, now, deadline }), {
        show: { kind: "job", job: read.job }, error: null, refresh: false, poll: "continue", follow: { kind: "following", jobId: otherJobId },
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
    const step = nextUpdatePollStep({ status: status("failed", otherJobId), follow: { kind: "settled", jobId }, now, deadline });
    assert.deepEqual(step, { show: { kind: "hidden" }, error: null, refresh: false, poll: "stop", follow: idle });
});

for (const [latest, read] of [
    ["no job", { serverId, job: null }],
    ["an older finished job", status("succeeded", otherJobId)],
] as const) {
    test(`keeps waiting for a requested job while ${latest} is the latest`, () => {
        const step = nextUpdatePollStep({ status: read, follow: { kind: "following", jobId }, now, deadline });
        assert.deepEqual(step, { show: { kind: "unchanged" }, error: null, refresh: false, poll: "continue", follow: { kind: "following", jobId } });
    });
}

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

test("following a new job clears the shown job and error until that job appears, in a new generation", () => {
    const settled: UpdateProgressState = { follow: { kind: "settled", jobId }, job: status("succeeded").job, error: "paused", generation: 1 };
    assert.deepEqual(updateProgressReducer(settled, { type: "follow", jobId: otherJobId }), {
        follow: { kind: "following", jobId: otherJobId }, job: null, error: null, generation: 2,
    });
});

test("ignores a step from a poll loop of an earlier generation", () => {
    // A loop that started before Update now saw nothing followed, so its step would hide the requested job; the reducer
    // drops it because its generation is older.
    const current: UpdateProgressState = { follow: { kind: "following", jobId }, job: null, error: null, generation: 1 };
    const step = nextUpdatePollStep({ status: status("failed"), follow: idle, now, deadline });
    assert.deepEqual(updateProgressReducer(current, { type: "step", generation: 0, step }), current);
});

test("keeps the shown running job and reports unavailable when a read fails while following", () => {
    const follow: UpdateFollow = { kind: "following", jobId };
    const following: UpdateProgressState = { ...INITIAL_UPDATE_PROGRESS_STATE, follow, job: status("running").job, generation: 1 };
    const step = nextUpdatePollStep({ status: null, follow, now, deadline });
    assert.deepEqual(updateProgressReducer(following, { type: "step", generation: 1, step }), {
        follow, job: following.job, error: "unavailable", generation: 1,
    });
});
