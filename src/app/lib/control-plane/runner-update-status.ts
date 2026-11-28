import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";

type RunnerUpdate = NonNullable<HostingAdminVpsHost["runnerUpdate"]>;
type UpdateState = RunnerUpdate["state"];

type StateDetails = {
    explanation: string;
    pending?: true;
    settlements?: Readonly<Record<string, string>>;
};

const updateStates: Record<UpdateState, StateDetails> = {
    queued: { explanation: "The durable host-wide runner update is waiting for the fleet worker.", pending: true },
    running: { explanation: "Every slot is being updated transactionally with stopped-state continuity checks.", pending: true },
    "retry-wait": { explanation: "A retryable update boundary failed; the durable workflow will resume after backoff.", pending: true },
    succeeded: { explanation: "Every isolated slot passed revision, identity, build, save, and capability verification." },
    failed: {
        explanation: "The update did not complete. Inspect the error code before retrying.",
        settlements: {
            runner_isolated_rolled_back: "The rollback was verified and the prior runner revision is active.",
            runner_isolated_applied_recovered: "Recovery verified the applied runner revision and completed the update.",
            runner_update_not_applied: "The attempt ended before the runner was switched.",
            runner_update_native_owner_template_incompatible: "The last attempt was refused by the native owner template check before switching the runner revision.",
        },
    },
};

export type RunnerUpdateStatus = {
    label: UpdateState | "settled" | "unknown";
    explanation: string;
    pending: boolean;
    progressStage: string | null;
    highlightError: boolean;
};

export function classifyRunnerUpdate(update: HostingAdminVpsHost["runnerUpdate"]): RunnerUpdateStatus | null {
    if (update == null) return null;
    if (!Object.hasOwn(updateStates, update.state)) {
        return {
            label: "unknown", explanation: "The control plane returned an unrecognized runner update state.",
            pending: false, progressStage: null, highlightError: false,
        };
    }
    const details = updateStates[update.state];
    const { settlements } = details;
    const { errorCode } = update;
    if (settlements && errorCode !== null && Object.hasOwn(settlements, errorCode)) {
        return { label: "settled", explanation: settlements[errorCode], pending: false, progressStage: null, highlightError: false };
    }
    return {
        label: update.state, explanation: details.explanation, pending: details.pending === true,
        progressStage: update.progressStage, highlightError: true,
    };
}
