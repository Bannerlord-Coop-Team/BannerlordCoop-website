import { BUILD_STEP_IDS, type BuildStepState, type BuildUpdateJob } from "../../../../supabase/functions/_shared/server-build-contract";

// Shared update-job fixtures for the update progress card, its polling hook and the Console tests.

/** Builds the six fixed update steps with the given states in display order; later steps default to pending. */
export function updateSteps(states: BuildStepState[]): BuildUpdateJob["steps"] {
    return BUILD_STEP_IDS.map((id, index) => ({ id, state: states[index] ?? "pending" }));
}

/** Builds an owner's running update job, three steps done and installing 0.1.11, with the given fields replaced. */
export function updateJob(overrides: Partial<BuildUpdateJob> = {}): BuildUpdateJob {
    return {
        jobId: "55555555-5555-4555-8555-555555555555", state: "running", initiatedBy: "owner", ownerSelected: false, phase: "installing",
        steps: updateSteps(["done", "done", "done", "active"]), completedSteps: 3, totalSteps: 6, targetVersion: "0.1.11", previousVersion: "0.1.10",
        progress: "Installing the update", backup: null, rolledBack: false, failureCode: null, failureMessage: null, nextStep: null,
        attemptCount: 1, maximumAttempts: 3, nextRetryAt: null, createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:01:00.000Z", completedAt: null,
        ...overrides,
    };
}
