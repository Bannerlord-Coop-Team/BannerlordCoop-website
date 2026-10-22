import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { ControlPlaneAdminError } from "./client";
import { isSlotCapacityOnboarding, MAXIMUM_VPS_SLOT_CAPACITY } from "./slot-capacity";
import type {
    HostingAdminVpsHost,
    HostingCancelVpsSlotDecommissionResult,
    HostingDecommissionVpsSlotsResult,
    HostingResolveVpsSlotDecommissionResult,
} from "./types";
import type { VpsHostTarget } from "./vps-providers";

/** The most slots a decommission may leave: a VPS holds at most 32, and lowering needs one fewer. */
export const MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY = MAXIMUM_VPS_SLOT_CAPACITY - 1;
/** The control plane's reason bounds for a decommission or a resolution: 3 to 1,000 characters once trimmed. */
const REASON_MINIMUM = 3;
const REASON_MAXIMUM = 1_000;
/** The highest evidence version a decommission row may reach (migration 110). */
const MAXIMUM_EVIDENCE_VERSION = 1_000;

const DECOMMISSION_KEYS = ["outcome", "provider", "serviceName", "vCpu", "slotCapacity", "targetSlots", "occupiedSlotIndexes", "runnerOnboarding"];
const CANCEL_KEYS = ["outcome", "provider", "serviceName", "slotCapacity", "runnerOnboarding"];
const RESOLVE_KEYS = ["outcome", "provider", "serviceName", "evidenceVersion", "runnerOnboarding"];
const DECOMMISSION_OUTCOMES: readonly string[] = ["draining", "queued", "unchanged", "completed", "cancelled", "superseded"];
const CANCEL_OUTCOMES: readonly string[] = ["cancelled", "unchanged"];
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/**
 * Answers that mean this control plane cannot decommission at all yet. They are shown as a calm note, not an alert:
 * the switch is off (the normal production answer), the release has no worker, or the operation is unknown. A control
 * plane without an operation fails its request schema with HTTP 400 `invalid_request`; the forms check every field
 * the schema checks, so that answer most likely means the operation is unknown.
 */
const CALM_CODES: ReadonlySet<string> = new Set([
    "vps_slot_decommission_disabled",
    "vps_slot_decommission_worker_unavailable",
    "invalid_request",
    "unsupported_operation",
]);

/** Why the control plane refused a decommission or its cancel, in the words an administrator acts on. */
const REFUSAL_MESSAGES: Record<string, string> = {
    vps_slot_decommission_disabled: "Slot decommissioning is switched off on this control plane (HOSTING_DYNAMIC_SLOT_CAPACITY is off), so nothing was changed.",
    vps_slot_decommission_worker_unavailable: "This control plane checks decommission requests but cannot carry one out yet, so nothing was changed. Decommissioning needs the control plane release with the decommission worker.",
    // The gates every decommission, cancel and resolution passes, in the control plane's order.
    vps_slot_decommission_unavailable: "The control plane is not in live VPS mode, so it cannot decommission slots or act on a decommission. Try again shortly.",
    vps_slot_decommission_provider_invalid: "This VPS's provider is not enabled on the control plane. Enable it in the control plane's configuration, then try again.",
    vps_slot_decommission_host_key_invalid: "The control plane has no registered VPS by this name. Refresh the VPS list; it may have been removed.",
    vps_slot_decommission_provider_unverified: "Slot decommissioning is verified on OVHcloud VPSs only, so this VPS has no slot decommission.",
    vps_slot_decommission_runner_scope_active: "A temporary runner update scope pauses runner jobs. Clear it before decommissioning slots or acting on a decommission.",
    vps_slot_decommission_source_unavailable: "The control plane could not resolve its runner revision. Try again shortly.",
    vps_slot_decommission_sizing_on: "Automatic slot sizing is on. Switch it off before decommissioning slots.",
    vps_slot_decommission_below_floor: "A VPS keeps at least floor(vCPU ÷ 2) slots, and at least one. Choose more slots.",
    vps_slot_decommission_not_lower: "A decommission lowers the slot capacity. Choose fewer slots than the VPS has now.",
    vps_slot_decommission_would_move: "This VPS holds more servers than that. A decommission never moves a server, so keep at least one slot for each server it holds.",
    vps_slot_decommission_relocation_inbound: "An automatic move onto this VPS is announced or queued. Decommission its slots once the move settles.",
    vps_slot_decommission_onboarding_incomplete: "Onboard this VPS, or retry its failed onboarding, before decommissioning its slots.",
    vps_slot_decommission_onboarding_active: "This VPS is still being onboarded. Decommission its slots once its onboarding succeeds.",
    vps_slot_decommission_runner_not_current: "Update this VPS to the current runner revision before decommissioning its slots.",
    vps_slot_decommission_runner_update_active: "This VPS has a runner update in progress or awaiting recovery. Decommission its slots once it resolves.",
    vps_slot_decommission_slots_unsettled: "Every slot of this VPS must be ready or assigned before its slots are decommissioned.",
    vps_slot_decommission_relocation_active: "A server on this VPS is being relocated. Decommission its slots once the move settles.",
    vps_slot_decommission_plan_conflict: "This VPS already has a decommission planned to another slot count. Cancel that plan before planning a different one.",
    vps_slot_decommission_state_inconsistent: "This VPS's decommission plan and its retired slots disagree. Open an incident; do not retry or edit the VPS.",
    vps_slot_decommission_failed_use_retry: "This VPS's decommission job failed after retiring its slots. Use Retry onboarding in the Runner column to roll it forward.",
    vps_slot_decommission_committed: "This decommission has already retired its slots and can no longer be cancelled; it rolls forward. Follow its runner onboarding, and use Retry onboarding if it fails.",
    vps_slot_decommission_recovery_conflict: "A retired slot of this VPS lies below the slot count requested. Request a slot count no higher than its lowest retired slot, so the decommission covers every retired slot.",
    vps_slot_decommission_not_resolvable: "This VPS's decommission cannot be resolved now: only a decommission that retired its slots, finished their teardown and then failed a kept-slot check can be. Refresh the VPS list and follow the Runner column.",
    vps_slot_decommission_evidence_changed: "This decommission's kept-slot evidence changed since it was reviewed. Refresh the VPS list and review it again before resolving.",
    vps_slot_decommission_slot_not_kept: "A listed slot is not one this decommission keeps. Only slots below the slot count it lowers the VPS to can be accepted or repaired.",
    vps_slot_decommission_assignment_changed: "A slot to accept holds another server than the decommission recorded, with no delete or move since its slots retired. Do not accept it; open an incident.",
    vps_slot_decommission_resolutions_full: "This decommission has recorded as many resolutions as it can hold. Open an incident.",
    vps_slot_decommission_plan_open: "This VPS has an unsettled slot decommission, so the preflight, which checks a fresh plan only, did not run.",
    vps_slot_decommission_preflight_failed: "The slot decommission preflight could not read the VPS. Try again shortly, or check its runner.",
    // An onboarding job's code rather than a request's refusal, listed so every decommission code reads the same way.
    slot_catalog_decommission_in_progress: "A slot decommission has retired slots inside this VPS's capacity, so its slots cannot be prepared; only a raise revives them.",
    // A control plane from before decommissioning rejects the operation it does not know.
    unsupported_operation: "This control plane cannot decommission slots yet. It needs a control plane release with slot decommissioning.",
    invalid_request: "This control plane refused the request as invalid. This form already checks the slot count and the reason, so the control plane most likely predates slot decommissioning.",
};

/** What a resolution sent to a control plane without the operation says. */
const RESOLVE_MESSAGES: Record<string, string> = {
    unsupported_operation: "This control plane cannot resolve kept slots yet. It needs the control plane release with the decommission worker.",
    invalid_request: "This control plane cannot resolve kept slots yet, or refused the request as invalid. This form already checks the slots and the reason, so the control plane most likely predates kept-slot resolution, which comes with the decommission worker.",
};

/**
 * The control plane's `request_conflict` messages for these operations. A replayed request id with other contents
 * conflicts; each submission here uses a new request id, so this is rare.
 */
const CONFLICT_MESSAGES: Record<string, string> = {
    "VPS slot decommission request conflicted": "The control plane recorded a different decommission under this request. Submit the decommission again.",
    "VPS slot decommission cancel conflicted": "The control plane recorded a different cancel under this request. Cancel again.",
    "VPS slot decommission resolution conflicted": "The control plane recorded a different resolution under this request. Refresh the VPS list and resolve again.",
    "VPS host provider conflicted": "The control plane stores this VPS under another provider. Refresh the VPS list.",
};

/**
 * The kept-slot continuity failures a resolution answers (control plane `VPS_SLOT_DECOMMISSION_RESOLVABLE_CODES`), and
 * what each says about the slot. Other `slot_decommission_kept_*` codes are not resolvable: `kept_unsettled` and
 * `kept_unobservable` call for a cancel before the slots retire (an incident after), and `kept_health_unavailable`
 * for a retry.
 */
const RESOLVABLE_FAILURES: Record<string, string> = {
    slot_decommission_kept_units_restarted: "its runner units restarted",
    slot_decommission_kept_controller_unavailable: "its game controller did not answer",
    slot_decommission_kept_game_newly_failed: "its game newly failed",
    slot_decommission_kept_game_changed: "its game changed in a way the check does not accept",
    slot_decommission_kept_canary_changed: "its canary file changed",
    slot_decommission_kept_assignment_changed: "it holds another server than recorded",
    slot_decommission_kept_tunnel_refused: "its private route refused a fresh tunnel",
};
/** The progress stage a kept-slot failure records, naming the zero-based slot it failed on. */
const KEPT_FAILURE_STAGE = /^slot-decommission-kept-slot-(\d{1,2})$/u;

/** One line of feedback for a decommission control: a result, a calm note, or an alert. */
export type SlotDecommissionNotice = { tone: "done" | "note" | "error"; text: string };

/**
 * Reads the requested capacity from the form: a whole number from 1 to 31 below the VPS's current capacity. The
 * control plane checks the same bounds, the floor of half the vCPUs and the servers held against the stored host.
 */
export function decommissionCapacityInput(value: string, current: number): { slotCapacity: number } | { error: string } {
    const text = value.trim();
    if (!/^[1-9]\d?$/u.test(text)) return { error: `Enter a whole number of slots from 1 to ${MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY}.` };
    const slotCapacity = Number(text);
    if (slotCapacity >= current) return { error: `Choose fewer than the ${current} ${current === 1 ? "slot" : "slots"} this VPS has now.` };
    if (slotCapacity > MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY) return { error: `A decommission leaves at most ${MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY} slots.` };
    return { slotCapacity };
}

/** Reads an audit reason as the control plane accepts it: 3 to 1,000 characters once trimmed, no control characters. */
export function decommissionReasonInput(value: string): { reason: string } | { error: string } {
    const reason = value.trim();
    if (reason.length < REASON_MINIMUM) return { error: `Give a reason of at least ${REASON_MINIMUM} characters; it is kept in the audit log.` };
    if (reason.length > REASON_MAXIMUM) return { error: `Keep the reason to ${REASON_MAXIMUM.toLocaleString("en-US")} characters.` };
    if (CONTROL_OR_FORMAT.test(reason)) return { error: "Remove line breaks and other control characters from the reason." };
    return { reason };
}

/** Whether the VPS's provider supports slot decommissioning: the control plane proves the teardown on OVHcloud only. */
export function slotDecommissionSupported(host: Pick<HostingAdminVpsHost, "provider">) {
    return host.provider === "ovhcloud-vps";
}

/** Whether the VPS row allows a decommission request: onboarded, idle and holding more than one slot. */
export function slotDecommissionAvailable(host: Pick<HostingAdminVpsHost, "runnerOnboarding" | "totalSlots">) {
    return host.runnerOnboarding !== null && !onboardingPending(host.runnerOnboarding.state) && host.totalSlots > 1;
}

/**
 * The kept-slot failure the VPS row's onboarding asks an administrator to resolve, or null: it failed with exactly one
 * of the codes a resolution answers, after the decommission's teardown. `slotIndex` is the zero-based slot its stage
 * names, or null when the stage names none.
 */
export function slotDecommissionKeptFailure(
    host: Pick<HostingAdminVpsHost, "runnerOnboarding">,
): { code: string; description: string; slotIndex: number | null } | null {
    const onboarding = host.runnerOnboarding;
    if (onboarding?.state !== "failed" || onboarding.errorCode === null || !Object.hasOwn(RESOLVABLE_FAILURES, onboarding.errorCode)) return null;
    const stage = KEPT_FAILURE_STAGE.exec(onboarding.progressStage);
    const slotIndex = stage === null ? null : Number(stage[1]);
    return {
        code: onboarding.errorCode,
        description: RESOLVABLE_FAILURES[onboarding.errorCode]!,
        slotIndex: slotIndex !== null && slotIndex < MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY ? slotIndex : null,
    };
}

/** Whether the VPS row's failed onboarding asks for the kept slots to be resolved. */
export function slotDecommissionResolvable(host: Pick<HostingAdminVpsHost, "runnerOnboarding">) {
    return slotDecommissionKeptFailure(host) !== null;
}

/**
 * Reads the resolution form: the kept slots to accept and to repair (zero-based indexes, as the decommission's
 * evidence and its failed stage name them) and a reason. It names no plan or evidence version: the control plane then
 * resolves the VPS's open retired plan at its stored version.
 */
export function resolveInput(fields: { accept: string; repair: string; reason: string }):
    | { reason: string; slots: Array<{ slotIndex: number; disposition: "accept" | "repair" }> }
    | { error: string } {
    const accept = slotIndexes(fields.accept);
    const repair = slotIndexes(fields.repair);
    if (accept === null || repair === null) {
        return { error: `List slots as zero-based indexes from 0 to ${MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY - 1}, separated by commas or spaces.` };
    }
    if (accept.length + repair.length === 0) return { error: "List at least one kept slot to accept or repair." };
    if (accept.some((index) => repair.includes(index))) return { error: "A slot can be accepted or repaired, not both." };
    const reason = decommissionReasonInput(fields.reason);
    if ("error" in reason) return reason;
    const slots = [
        ...accept.map((slotIndex) => ({ slotIndex, disposition: "accept" as const })),
        ...repair.map((slotIndex) => ({ slotIndex, disposition: "repair" as const })),
    ].sort((left, right) => left.slotIndex - right.slotIndex);
    return { reason: reason.reason, slots };
}

/**
 * Accepts exactly the control plane's decommission result for the host and capacity that were requested; anything
 * else, including a result for another host or a tail slot outside `[requested, capacity)`, is rejected.
 */
export function parseDecommissionVpsSlotsResult(
    value: unknown,
    request: VpsHostTarget & { slotCapacity: number },
): HostingDecommissionVpsSlotsResult | null {
    if (!isRecord(value) || !hasExactKeys(value, DECOMMISSION_KEYS)) return null;
    const { outcome, provider, serviceName, vCpu, slotCapacity, targetSlots, occupiedSlotIndexes, runnerOnboarding } = value;
    if (typeof outcome !== "string" || !DECOMMISSION_OUTCOMES.includes(outcome)
        || provider !== request.provider || serviceName !== request.serviceName
        || !wholeNumber(vCpu, 2, 64) || !wholeNumber(slotCapacity, 1, MAXIMUM_VPS_SLOT_CAPACITY)
        || (targetSlots !== null && !wholeNumber(targetSlots, 1, MAXIMUM_VPS_SLOT_CAPACITY))
        || !Array.isArray(occupiedSlotIndexes) || occupiedSlotIndexes.length > MAXIMUM_VPS_SLOT_CAPACITY) return null;
    // The occupied tail is `[requested, capacity)`, in ascending slot order.
    let previous = request.slotCapacity - 1;
    for (const index of occupiedSlotIndexes) {
        if (!wholeNumber(index, previous + 1, slotCapacity - 1)) return null;
        previous = index;
    }
    if (runnerOnboarding !== null && !isSlotCapacityOnboarding(runnerOnboarding)) return null;
    return {
        outcome: outcome as HostingDecommissionVpsSlotsResult["outcome"],
        provider: request.provider, serviceName: request.serviceName, vCpu, slotCapacity, targetSlots,
        occupiedSlotIndexes: [...occupiedSlotIndexes] as number[],
        runnerOnboarding: runnerOnboarding as HostingDecommissionVpsSlotsResult["runnerOnboarding"],
    };
}

/** Accepts exactly the control plane's cancel result for the requested host. */
export function parseCancelVpsSlotDecommissionResult(value: unknown, request: VpsHostTarget): HostingCancelVpsSlotDecommissionResult | null {
    if (!isRecord(value) || !hasExactKeys(value, CANCEL_KEYS)) return null;
    const { outcome, provider, serviceName, slotCapacity, runnerOnboarding } = value;
    if (typeof outcome !== "string" || !CANCEL_OUTCOMES.includes(outcome)
        || provider !== request.provider || serviceName !== request.serviceName
        || !wholeNumber(slotCapacity, 1, MAXIMUM_VPS_SLOT_CAPACITY)) return null;
    if (runnerOnboarding !== null && !isSlotCapacityOnboarding(runnerOnboarding)) return null;
    return {
        outcome: outcome as HostingCancelVpsSlotDecommissionResult["outcome"],
        provider: request.provider, serviceName: request.serviceName, slotCapacity,
        runnerOnboarding: runnerOnboarding as HostingCancelVpsSlotDecommissionResult["runnerOnboarding"],
    };
}

/** Accepts exactly the control plane's resolution result for the requested host: a requeued job and its onboarding. */
export function parseResolveVpsSlotDecommissionResult(value: unknown, request: VpsHostTarget): HostingResolveVpsSlotDecommissionResult | null {
    if (!isRecord(value) || !hasExactKeys(value, RESOLVE_KEYS)) return null;
    const { outcome, provider, serviceName, evidenceVersion, runnerOnboarding } = value;
    if (outcome !== "requeued" || provider !== request.provider || serviceName !== request.serviceName
        || !wholeNumber(evidenceVersion, 1, MAXIMUM_EVIDENCE_VERSION) || !isSlotCapacityOnboarding(runnerOnboarding)) return null;
    return { outcome, provider: request.provider, serviceName: request.serviceName, evidenceVersion, runnerOnboarding };
}

/** The sentence shown after a decommission request is answered, for a VPS lowered to `requested` slots. */
export function decommissionResultMessage(result: HostingDecommissionVpsSlotsResult, requested: number) {
    const tail = slotRange(requested, result.slotCapacity);
    switch (result.outcome) {
        case "draining": return result.occupiedSlotIndexes.length > 0
            ? `Planned: ${tail} retire once ${slotList(result.occupiedSlotIndexes)} ${result.occupiedSlotIndexes.length === 1 ? "is" : "are"} empty. A decommission never moves a server; new servers go only to the kept slots meanwhile. Submit the same decommission again once ${result.occupiedSlotIndexes.length === 1 ? "it is" : "they are"} empty to queue it.`
            : `Planned: ${tail} are empty now. Submit the same decommission again to queue it.`;
        case "queued": return `Queued: the control plane is decommissioning ${tail}, lowering this VPS to ${requested} ${requested === 1 ? "slot" : "slots"}. The Runner column follows the job; the VPS takes no new servers until it succeeds, and its current servers keep running.`;
        case "unchanged": return "Nothing changed: this VPS already has a decommission or runner job queued or under way. Follow the Runner column.";
        case "completed": return `This request already completed: the VPS was lowered to ${requested} ${requested === 1 ? "slot" : "slots"} and has ${result.slotCapacity} now.`;
        case "cancelled": return "This request was cancelled; nothing changed. Submit a new decommission to plan again.";
        case "superseded": return "This request was superseded by a recovery plan; nothing changed. The Runner column follows the recovery.";
    }
}

/** The sentence shown after a cancel is answered. */
export function cancelResultMessage(result: HostingCancelVpsSlotDecommissionResult) {
    return result.outcome === "cancelled"
        ? `Cancelled the decommission plan; the VPS keeps its ${result.slotCapacity} ${result.slotCapacity === 1 ? "slot" : "slots"}. If its decommission job had already failed, use Retry onboarding.`
        : "This VPS has no open decommission plan; nothing changed.";
}

/** The sentence shown after a resolution is recorded. */
export function resolveResultMessage(result: HostingResolveVpsSlotDecommissionResult) {
    return `Recorded the resolution against evidence version ${result.evidenceVersion} and requeued the decommission job. The Runner column follows it.`;
}

/** Turns a refused or failed decommission or cancel into a calm note or an alert. */
export function decommissionErrorNotice(error: unknown): SlotDecommissionNotice {
    if (error instanceof ControlPlaneAdminError && error.code === "request_conflict" && Object.hasOwn(CONFLICT_MESSAGES, error.message)) {
        return { tone: "error", text: CONFLICT_MESSAGES[error.message]! };
    }
    if (error instanceof ControlPlaneAdminError && Object.hasOwn(REFUSAL_MESSAGES, error.code)) {
        return { tone: CALM_CODES.has(error.code) ? "note" : "error", text: REFUSAL_MESSAGES[error.code]! };
    }
    return { tone: "error", text: error instanceof Error ? error.message : "The slot decommission could not be requested." };
}

/** Turns a refused or failed resolution into a calm note or an alert. */
export function resolveErrorNotice(error: unknown): SlotDecommissionNotice {
    if (error instanceof ControlPlaneAdminError && Object.hasOwn(RESOLVE_MESSAGES, error.code)) {
        return { tone: "note", text: RESOLVE_MESSAGES[error.code]! };
    }
    return decommissionErrorNotice(error);
}

/** Names zero-based slots as the slot table does: Slot 1 is index 0. */
export function slotList(indexes: readonly number[]) {
    const names = indexes.map((index) => String(index + 1));
    if (names.length === 1) return `Slot ${names[0]}`;
    return `Slots ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Names the tail `[from, to)` as the slot table does. */
function slotRange(from: number, to: number) {
    if (to - from <= 0) return "no slots";
    return to - from === 1 ? `Slot ${to}` : `Slots ${from + 1}–${to}`;
}

/** Parses a comma- or space-separated list of distinct kept slot indexes; null when any entry is not one. */
function slotIndexes(value: string): number[] | null {
    const entries = value.split(/[\s,]+/u).filter(Boolean);
    const indexes: number[] = [];
    for (const entry of entries) {
        if (!/^\d{1,2}$/u.test(entry)) return null;
        const index = Number(entry);
        if (index > MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY - 1 || indexes.includes(index)) return null;
        indexes.push(index);
    }
    return indexes;
}

function onboardingPending(state: NonNullable<HostingAdminVpsHost["runnerOnboarding"]>["state"]) {
    return state === "queued" || state === "running" || state === "retry-wait";
}

function wholeNumber(value: unknown, minimum: number, maximum: number): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}
