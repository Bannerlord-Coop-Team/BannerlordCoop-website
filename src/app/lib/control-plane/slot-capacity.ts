import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { ControlPlaneAdminError } from "./client";
import type { HostingAdminVpsHost, HostingRaiseVpsSlotCapacityResult } from "./types";
import type { VpsHostTarget } from "./vps-providers";

/** The most slots a VPS may hold: the control plane's slot-index, port and runner bound. */
export const MAXIMUM_VPS_SLOT_CAPACITY = 32;

const RESULT_KEYS = ["outcome", "provider", "serviceName", "vCpu", "previousSlotCapacity", "slotCapacity", "runnerOnboarding"];
const ONBOARDING_KEYS = ["state", "progressStage", "errorCode", "sourceCommit", "updatedAt"];
const ONBOARDING_STATES: readonly string[] = ["queued", "running", "retry-wait", "succeeded", "failed"];
const SOURCE_COMMIT = /^[a-f\d]{40}$/u;

/** Why the control plane refused a raise, in the words an administrator acts on. */
const REFUSAL_MESSAGES: Record<string, string> = {
    vps_slot_capacity_disabled: "Raising a slot capacity is switched off on the control plane (HOSTING_DYNAMIC_SLOT_CAPACITY).",
    vps_slot_capacity_unavailable: "The control plane is not in live VPS mode, so no slot capacity can be raised.",
    vps_slot_capacity_provider_invalid: "This VPS's provider is not enabled on the control plane. Enable it in the control plane's configuration before raising this VPS's slot capacity.",
    vps_slot_capacity_host_key_invalid: "The control plane has no registered VPS by this name. Refresh the VPS list; it may have been removed.",
    vps_slot_capacity_runner_scope_active: "A temporary runner update scope pauses commissioning. Clear it before raising a slot capacity.",
    vps_slot_capacity_source_unavailable: "The control plane could not resolve its runner revision. Try again shortly.",
    vps_slot_capacity_shrink: "A slot capacity is never lowered. Choose more slots than the VPS has now.",
    vps_slot_capacity_onboarding_incomplete: "Onboard this VPS, or retry its failed onboarding, before raising its slot capacity.",
    vps_slot_capacity_onboarding_active: "This VPS is still being onboarded. Raise its slot capacity once its onboarding succeeds.",
    vps_slot_capacity_runner_not_current: "Update this VPS to the current runner revision before raising its slot capacity.",
    vps_slot_capacity_runner_update_active: "This VPS has a runner update in progress or awaiting recovery. Raise its slot capacity once it resolves.",
    vps_slot_capacity_slots_unsettled: "Every slot of this VPS must be ready or assigned before its slot capacity is raised.",
    vps_slot_capacity_relocation_active: "A server on this VPS is being relocated. Raise its slot capacity once the move settles.",
    vps_slot_capacity_decommission_planned: "This VPS has an unsettled slot decommission. Cancel its decommission plan, or let a decommission that already retired slots finish, before raising its slot capacity.",
    // A control plane from before the raise rejects the operation it does not know.
    unsupported_operation: "This control plane cannot raise a slot capacity yet. Deploy a control plane with slot capacity raises first.",
    // The form only sends a whole number up to 32, so an invalid request is most likely an older control plane.
    invalid_request: "The control plane refused the request as invalid. It may predate slot capacity raises, which need a newer control plane; a capacity must also be a whole number from 1 to 32.",
};

/**
 * Reads the requested capacity from the form: a whole number above the VPS's current capacity and at most 32.
 * The control plane checks the same bounds against the stored host, so this only saves a round trip.
 */
export function slotCapacityInput(value: string, current: number): { slotCapacity: number } | { error: string } {
    const text = value.trim();
    if (!/^\d{1,2}$/u.test(text)) return { error: `Enter a whole number of slots up to ${MAXIMUM_VPS_SLOT_CAPACITY}.` };
    const slotCapacity = Number(text);
    if (slotCapacity > MAXIMUM_VPS_SLOT_CAPACITY) return { error: `A VPS holds at most ${MAXIMUM_VPS_SLOT_CAPACITY} slots.` };
    if (slotCapacity <= current) return { error: `Choose more than the ${current} ${current === 1 ? "slot" : "slots"} this VPS has now; a capacity is never lowered.` };
    return { slotCapacity };
}

/** Whether the VPS row allows a raise at all: its onboarding succeeded and it has fewer than 32 slots. */
export function slotCapacityRaisable(host: Pick<HostingAdminVpsHost, "runnerOnboarding" | "totalSlots">) {
    return host.runnerOnboarding?.state === "succeeded" && host.totalSlots < MAXIMUM_VPS_SLOT_CAPACITY;
}

/**
 * Accepts exactly the control plane's raise result for the host and capacity that were requested; anything else,
 * including a result for another host, is rejected rather than shown.
 */
export function parseRaiseVpsSlotCapacityResult(
    value: unknown,
    request: VpsHostTarget & { slotCapacity: number },
): HostingRaiseVpsSlotCapacityResult | null {
    if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) return null;
    const { outcome, provider, serviceName, vCpu, previousSlotCapacity, slotCapacity, runnerOnboarding } = value;
    if ((outcome !== "raised" && outcome !== "unchanged") || provider !== request.provider || serviceName !== request.serviceName
        || slotCapacity !== request.slotCapacity || !wholeNumber(vCpu, 2, 64)
        || !wholeNumber(previousSlotCapacity, Math.max(1, Math.floor(vCpu / 2)), slotCapacity)
        || (outcome === "unchanged") !== (previousSlotCapacity === slotCapacity)) return null;
    // Only an unchanged host that was never onboarded has no onboarding; a raise always queues one.
    if (runnerOnboarding === null ? outcome !== "unchanged" : !isSlotCapacityOnboarding(runnerOnboarding)) return null;
    return {
        outcome, provider: request.provider, serviceName: request.serviceName, vCpu, previousSlotCapacity,
        slotCapacity: request.slotCapacity,
        runnerOnboarding: runnerOnboarding as HostingRaiseVpsSlotCapacityResult["runnerOnboarding"],
    };
}

/** The sentence shown after a raise succeeds. */
export function slotCapacityResultMessage(result: HostingRaiseVpsSlotCapacityResult) {
    if (result.outcome === "unchanged") return `This VPS already has ${result.slotCapacity} slots; nothing changed.`;
    return `Raised from ${result.previousSlotCapacity} to ${result.slotCapacity} slots. The VPS is being re-commissioned for the new slots and takes no new servers until its onboarding succeeds; its current servers keep running.`;
}

/** Turns a refused or failed raise into text for the administrator. */
export function slotCapacityErrorMessage(error: unknown) {
    if (error instanceof ControlPlaneAdminError && Object.hasOwn(REFUSAL_MESSAGES, error.code)) return REFUSAL_MESSAGES[error.code]!;
    return error instanceof Error ? error.message : "The slot capacity could not be raised.";
}

function wholeNumber(value: unknown, minimum: number, maximum: number): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

/** Whether a value is exactly a host's runner onboarding as the VPS inventory and the slot capacity results show it. */
export function isSlotCapacityOnboarding(value: unknown): value is NonNullable<HostingRaiseVpsSlotCapacityResult["runnerOnboarding"]> {
    return isRecord(value) && hasExactKeys(value, ONBOARDING_KEYS)
        && typeof value.state === "string" && ONBOARDING_STATES.includes(value.state)
        && typeof value.progressStage === "string" && value.progressStage.length >= 1 && value.progressStage.length <= 128
        && (value.errorCode === null || (typeof value.errorCode === "string" && /^[a-z0-9_-]{1,64}$/u.test(value.errorCode)))
        && (value.sourceCommit === null || (typeof value.sourceCommit === "string" && SOURCE_COMMIT.test(value.sourceCommit)))
        && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt));
}
