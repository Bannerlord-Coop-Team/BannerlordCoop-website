import assert from "node:assert/strict";
import test from "node:test";
import type { BuildUpdateJob, BuildStatus } from "../../../../supabase/functions/_shared/server-build-contract";
import { nextUpdatePollStep, updateProgressReducer, type UpdateFollow, type UpdateProgressState } from "./use-server-update-progress";
import { updateJobInState } from "./ServerUpdateProgress.test-utils";

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "55555555-5555-4555-8555-555555555555";
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
    const other = "66666666-6666-4666-8666-666666666666";
    const read = status("running", other);
    assert.deepEqual(nextUpdatePollStep({ status: read, follow: { kind: "following", jobId }, now, deadline }), {
        show: { kind: "job", job: read.job }, error: null, refresh: false, poll: "continue", follow: { kind: "following", jobId: other },
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

for (const [latest, read] of [
    ["no job", { serverId, job: null }],
    ["an older finished job", status("succeeded", "66666666-6666-4666-8666-666666666666")],
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

test("following a new job clears the shown job and error until that job appears", () => {
    const settled: UpdateProgressState = { follow: { kind: "settled", jobId }, job: status("succeeded").job, error: "paused" };
    const other = "66666666-6666-4666-8666-666666666666";
    assert.deepEqual(updateProgressReducer(settled, { type: "follow", jobId: other }), {
        follow: { kind: "following", jobId: other }, job: null, error: null,
    });
});

test("ignores a step decided from a follow state that has since been replaced", () => {
    const stale: UpdateFollow = { kind: "idle" };
    const current: UpdateProgressState = { follow: { kind: "following", jobId }, job: null, error: null };
    const step = nextUpdatePollStep({ status: status("failed"), follow: stale, now, deadline });
    assert.equal(updateProgressReducer(current, { type: "step", from: stale, step }), current);
});
