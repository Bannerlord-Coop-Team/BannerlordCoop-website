import { describe, expect, it } from "vitest";
import { ControlPlaneAdminError } from "./client";
import { slotCapacityErrorMessage } from "./slot-capacity";
import {
    cancelResultMessage,
    decommissionCapacityInput,
    decommissionErrorNotice,
    decommissionReasonInput,
    decommissionResultMessage,
    parseCancelVpsSlotDecommissionResult,
    parseDecommissionVpsSlotsResult,
    parseResolveVpsSlotDecommissionResult,
    resolveErrorNotice,
    resolveInput,
    resolveResultMessage,
    slotDecommissionAvailable,
    slotDecommissionKeptFailure,
    slotDecommissionResolvable,
    slotDecommissionPaused,
    slotDecommissionSupported,
    slotList,
} from "./slot-decommission";

const SERVICE_NAME = "vps-a1b2c3d4.vps.ovh.us";
const HOST = { provider: "ovhcloud-vps" as const, serviceName: SERVICE_NAME };
const ONBOARDING = {
    state: "succeeded", progressStage: "runner-active", errorCode: null,
    sourceCommit: "a".repeat(40), updatedAt: "2026-10-21T12:00:00.000Z",
};
const DRAINING = {
    outcome: "draining", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, vCpu: 8, slotCapacity: 8, targetSlots: 5,
    occupiedSlotIndexes: [5, 7], runnerOnboarding: ONBOARDING,
};
const CANCELLED = { outcome: "cancelled", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, slotCapacity: 8, runnerOnboarding: ONBOARDING };
const REQUEUED = {
    outcome: "requeued", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, evidenceVersion: 1,
    runnerOnboarding: { ...ONBOARDING, state: "queued", progressStage: "slot-decommission-kept-resolved" },
};
const without = (value: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

describe("the slot decommission result", () => {
    const request = { ...HOST, slotCapacity: 5 };

    it("accepts exactly the result keys for the requested host and capacity", () => {
        expect(parseDecommissionVpsSlotsResult(DRAINING, request)).toEqual(DRAINING);
        // A never-onboarded host has no onboarding, and a host whose plan settled has no target.
        expect(parseDecommissionVpsSlotsResult({ ...DRAINING, runnerOnboarding: null, targetSlots: null }, request))
            .toMatchObject({ runnerOnboarding: null, targetSlots: null });
    });

    it.each(["draining", "queued", "unchanged", "completed", "cancelled", "superseded"])("accepts the %s outcome", (outcome) => {
        expect(parseDecommissionVpsSlotsResult({ ...DRAINING, outcome }, request)).toMatchObject({ outcome });
    });

    it.each(Object.keys(DRAINING))("rejects a result missing %s", (key) => {
        expect(parseDecommissionVpsSlotsResult(without(DRAINING, key), request)).toBeNull();
    });

    it.each([
        ["an extra key", { evidenceVersion: 1 }],
        ["an unknown outcome", { outcome: "requeued" }],
        ["another host", { serviceName: "vps-other.vps.ovh.us" }],
        ["another provider", { provider: "contabo-vps" }],
        ["a fractional vCPU count", { vCpu: 4.5 }],
        ["a capacity above 32", { slotCapacity: 33 }],
        ["a target of 0", { targetSlots: 0 }],
        ["an occupied slot below the requested capacity", { occupiedSlotIndexes: [4] }],
        ["an occupied slot at the capacity", { occupiedSlotIndexes: [8] }],
        ["occupied slots out of order", { occupiedSlotIndexes: [7, 5] }],
        ["a repeated occupied slot", { occupiedSlotIndexes: [5, 5] }],
        ["occupied slots that are not a list", { occupiedSlotIndexes: "5,7" }],
        ["an extra onboarding key", { runnerOnboarding: { ...ONBOARDING, attemptCount: 1 } }],
        ["an unknown onboarding state", { runnerOnboarding: { ...ONBOARDING, state: "paused" } }],
    ])("rejects %s", (_label, change) => {
        expect(parseDecommissionVpsSlotsResult({ ...DRAINING, ...change }, request)).toBeNull();
    });

    it("rejects anything that is not an object", () => {
        for (const value of [null, undefined, "draining", 5, [DRAINING]]) expect(parseDecommissionVpsSlotsResult(value, request)).toBeNull();
    });

    it("says what each outcome means, naming slots as the slot table does", () => {
        const result = parseDecommissionVpsSlotsResult(DRAINING, request)!;
        expect(decommissionResultMessage(result, 5)).toMatch(/^Planned: Slots 6–8 retire once Slots 6 and 8 are empty\. A decommission never moves a server/u);
        expect(decommissionResultMessage({ ...result, occupiedSlotIndexes: [] }, 5)).toBe("Planned: Slots 6–8 are empty now. Submit the same decommission again to queue it.");
        expect(decommissionResultMessage({ ...result, outcome: "queued", occupiedSlotIndexes: [] }, 7)).toMatch(/^Queued: the control plane is decommissioning Slot 8, lowering this VPS to 7 slots\./u);
        expect(decommissionResultMessage({ ...result, outcome: "unchanged" }, 5))
            .toBe("Nothing changed: this VPS already has a decommission or runner job queued or under way. Follow the Runner column.");
        expect(decommissionResultMessage({ ...result, outcome: "completed", slotCapacity: 5 }, 5)).toMatch(/already completed/u);
        expect(decommissionResultMessage({ ...result, outcome: "cancelled" }, 5)).toMatch(/was cancelled; nothing changed/u);
        expect(decommissionResultMessage({ ...result, outcome: "superseded" }, 5)).toMatch(/superseded by a recovery plan/u);
        expect(slotList([0])).toBe("Slot 1");
        expect(slotList([1, 2, 4])).toBe("Slots 2, 3 and 5");
    });
});

describe("the slot decommission cancel result", () => {
    it("accepts exactly the result keys for the requested host", () => {
        expect(parseCancelVpsSlotDecommissionResult(CANCELLED, HOST)).toEqual(CANCELLED);
        expect(parseCancelVpsSlotDecommissionResult({ ...CANCELLED, runnerOnboarding: null }, HOST)).toMatchObject({ runnerOnboarding: null });
    });

    it.each(["cancelled", "unchanged"])("accepts the %s outcome", (outcome) => {
        expect(parseCancelVpsSlotDecommissionResult({ ...CANCELLED, outcome }, HOST)).toMatchObject({ outcome });
    });

    it.each(Object.keys(CANCELLED))("rejects a result missing %s", (key) => {
        expect(parseCancelVpsSlotDecommissionResult(without(CANCELLED, key), HOST)).toBeNull();
    });

    it.each([
        ["an extra key", { vCpu: 8 }],
        ["a decommission outcome", { outcome: "draining" }],
        ["another host", { serviceName: "vps-other.vps.ovh.us" }],
        ["a capacity of 0", { slotCapacity: 0 }],
        ["a malformed onboarding", { runnerOnboarding: { ...ONBOARDING, sourceCommit: "main" } }],
    ])("rejects %s", (_label, change) => {
        expect(parseCancelVpsSlotDecommissionResult({ ...CANCELLED, ...change }, HOST)).toBeNull();
    });

    it("says what changed", () => {
        expect(cancelResultMessage(parseCancelVpsSlotDecommissionResult(CANCELLED, HOST)!)).toMatch(/^Cancelled the decommission plan; the VPS keeps its 8 slots\./u);
        expect(cancelResultMessage({ ...parseCancelVpsSlotDecommissionResult(CANCELLED, HOST)!, outcome: "unchanged" }))
            .toBe("This VPS has no open decommission plan; nothing changed.");
    });
});

describe("the kept-slot resolution result", () => {
    it("accepts exactly the result keys and the requeued outcome", () => {
        expect(parseResolveVpsSlotDecommissionResult(REQUEUED, HOST)).toEqual(REQUEUED);
        expect(resolveResultMessage(parseResolveVpsSlotDecommissionResult(REQUEUED, HOST)!)).toMatch(/evidence version 1 and requeued/u);
    });

    it.each(Object.keys(REQUEUED))("rejects a result missing %s", (key) => {
        expect(parseResolveVpsSlotDecommissionResult(without(REQUEUED, key), HOST)).toBeNull();
    });

    it.each([
        ["an extra key", { token: "a".repeat(64) }],
        ["another outcome", { outcome: "queued" }],
        ["another host", { serviceName: "vps-other.vps.ovh.us" }],
        ["evidence version 0", { evidenceVersion: 0 }],
        ["an evidence version above 1,000", { evidenceVersion: 1_001 }],
        ["no onboarding", { runnerOnboarding: null }],
    ])("rejects %s", (_label, change) => {
        expect(parseResolveVpsSlotDecommissionResult({ ...REQUEUED, ...change }, HOST)).toBeNull();
    });
});

describe("the slot decommission forms", () => {
    it("takes a whole number of slots below the current capacity", () => {
        expect(decommissionCapacityInput(" 5 ", 8)).toEqual({ slotCapacity: 5 });
        expect(decommissionCapacityInput("31", 32)).toEqual({ slotCapacity: 31 });
        expect(decommissionCapacityInput("8", 8)).toEqual({ error: "Choose fewer than the 8 slots this VPS has now." });
        for (const value of ["", "0", "00", "05", "007", "4.5", "-4", "1e1", "six", "100"]) expect(decommissionCapacityInput(value, 8)).toHaveProperty("error");
    });

    it("takes a reason the control plane accepts", () => {
        expect(decommissionReasonInput("  Too few players  ")).toEqual({ reason: "Too few players" });
        expect(decommissionReasonInput("ok")).toHaveProperty("error");
        expect(decommissionReasonInput("x".repeat(1_001))).toHaveProperty("error");
        expect(decommissionReasonInput("two\nlines")).toHaveProperty("error");
    });

    it("offers a decommission only on an onboarded, idle VPS with more than one slot", () => {
        expect(slotDecommissionAvailable({ runnerOnboarding: ONBOARDING as never, totalSlots: 4 })).toBe(true);
        expect(slotDecommissionAvailable({ runnerOnboarding: { ...ONBOARDING, state: "failed" } as never, totalSlots: 4 })).toBe(true);
        expect(slotDecommissionAvailable({ runnerOnboarding: ONBOARDING as never, totalSlots: 1 })).toBe(false);
        expect(slotDecommissionAvailable({ runnerOnboarding: null, totalSlots: 4 })).toBe(false);
        for (const state of ["queued", "running", "retry-wait"]) {
            expect(slotDecommissionAvailable({ runnerOnboarding: { ...ONBOARDING, state } as never, totalSlots: 4 })).toBe(false);
        }
    });

    it("offers the controls only on OVHcloud, where the control plane decommissions", () => {
        expect(slotDecommissionSupported({ provider: "ovhcloud-vps" })).toBe(true);
        expect(slotDecommissionSupported({ provider: "contabo-vps" })).toBe(false);
    });

    const failed = (errorCode: string | null, progressStage = "slot-decommission-kept-slot-2") =>
        ({ runnerOnboarding: { ...ONBOARDING, state: "failed", progressStage, errorCode } as never });

    it.each([
        "slot_decommission_kept_units_restarted",
        "slot_decommission_kept_controller_unavailable",
        "slot_decommission_kept_game_newly_failed",
        "slot_decommission_kept_game_changed",
        "slot_decommission_kept_canary_changed",
        "slot_decommission_kept_assignment_changed",
        "slot_decommission_kept_tunnel_refused",
    ])("asks for a resolution after the kept-slot failure %s", (code) => {
        expect(slotDecommissionResolvable(failed(code))).toBe(true);
        expect(slotDecommissionKeptFailure(failed(code))).toEqual({
            code, description: expect.any(String), slotIndex: 2, onboardingUpdatedAt: ONBOARDING.updatedAt,
        });
    });

    it.each([
        // Before anything retires these call for a cancel (an incident after), and the last for a retry.
        "slot_decommission_kept_unsettled", "slot_decommission_kept_unobservable", "slot_decommission_kept_health_unavailable",
        "slot_decommission_kept_something_new", "slot_decommission_tail_not_empty", null,
    ])("asks for no resolution after %s", (code) => {
        expect(slotDecommissionResolvable(failed(code))).toBe(false);
        expect(slotDecommissionKeptFailure(failed(code))).toBeNull();
    });

    it("asks for a resolution only while the onboarding is failed, and names the slot only from its kept-slot stage", () => {
        const code = "slot_decommission_kept_game_newly_failed";
        expect(slotDecommissionResolvable({ runnerOnboarding: { ...ONBOARDING, errorCode: code } as never })).toBe(false);
        expect(slotDecommissionResolvable({ runnerOnboarding: null })).toBe(false);
        expect(slotDecommissionKeptFailure(failed(code, "slot-decommission-kept-slot-0"))).toMatchObject({ slotIndex: 0, description: "its game newly failed" });
        for (const stage of ["slot-decommission-continuity", "slot-decommission-kept-slot-", "slot-decommission-kept-slot-31", "slot-decommission-kept-slot-x"]) {
            expect(slotDecommissionKeptFailure(failed(code, stage))).toMatchObject({ slotIndex: null });
        }
    });

    it("reads a resolution's slots and reason, bound to the shown failure's onboarding time and naming no plan", () => {
        const fields = { accept: "3, 1", repair: "0", reason: "Owner restarted the game" };
        const at = "2026-10-22T09:00:00.000Z";
        expect(resolveInput(fields, at)).toStrictEqual({
            slots: [{ slotIndex: 0, disposition: "repair" }, { slotIndex: 1, disposition: "accept" }, { slotIndex: 3, disposition: "accept" }],
            reason: "Owner restarted the game",
            expectedOnboardingUpdatedAt: at,
        });
        expect(resolveInput({ ...fields, accept: "", repair: "" }, at)).toEqual({ error: "List at least one kept slot to accept or repair." });
        expect(resolveInput({ ...fields, repair: "1" }, at)).toEqual({ error: "A slot can be accepted or repaired, not both." });
        for (const accept of ["31", "1,1", "a", "1.5", "01", "00", "-1"]) expect(resolveInput({ ...fields, accept }, at)).toHaveProperty("error");
        expect(resolveInput({ ...fields, accept: "0 10, 30", repair: "" }, at)).toMatchObject({ slots: [{ slotIndex: 0 }, { slotIndex: 10 }, { slotIndex: 30 }] });
        expect(resolveInput({ ...fields, reason: "no" }, at)).toHaveProperty("error");
        // The control plane's own timestamp form only: a time it would refuse is not sent.
        for (const time of ["2026-10-22T09:00:00Z", "2026-10-22T09:00:00.000+00:00", ""]) {
            expect(resolveInput(fields, time)).toEqual({ error: expect.stringMatching(/Refresh the VPS list/u) });
        }
    });

    it("recognises a decommission job the switch paused", () => {
        const paused = { ...ONBOARDING, state: "retry-wait", progressStage: "slot-decommission-paused", errorCode: "slot_decommission_disabled" } as never;
        expect(slotDecommissionPaused(paused)).toBe(true);
        expect(slotDecommissionPaused({ ...ONBOARDING, state: "failed", errorCode: "slot_decommission_kept_game_newly_failed" } as never)).toBe(false);
        expect(slotDecommissionPaused(ONBOARDING as never)).toBe(false);
        expect(slotDecommissionPaused(null)).toBe(false);
    });
});

describe("decommission refusals", () => {
    const notice = (code: string) => decommissionErrorNotice(new ControlPlaneAdminError(code, "raw control plane text"));

    it("reports a switched-off or older control plane as a calm note, not an alert", () => {
        expect(notice("vps_slot_decommission_disabled")).toEqual({ tone: "note", text: expect.stringMatching(/switched off on this control plane \(HOSTING_DYNAMIC_SLOT_CAPACITY is off\), so nothing was changed/u) });
        expect(notice("vps_slot_decommission_worker_unavailable")).toEqual({ tone: "note", text: expect.stringMatching(/cannot carry one out yet, so nothing was changed/u) });
        expect(notice("invalid_request")).toEqual({ tone: "note", text: expect.stringMatching(/most likely predates slot decommissioning/u) });
        expect(notice("unsupported_operation")).toEqual({ tone: "note", text: expect.stringMatching(/cannot decommission slots yet/u) });
    });

    it.each([
        ["vps_slot_decommission_unavailable", /not in live VPS mode/u],
        ["vps_slot_decommission_provider_invalid", /provider is not enabled/u],
        ["vps_slot_decommission_host_key_invalid", /Refresh the VPS list/u],
        ["vps_slot_decommission_provider_unverified", /OVHcloud VPSs only/u],
        ["vps_slot_decommission_runner_scope_active", /runner update scope/u],
        ["vps_slot_decommission_source_unavailable", /runner revision\. Try again/u],
        ["vps_slot_decommission_sizing_on", /Switch it off/u],
        ["vps_slot_decommission_below_floor", /floor\(vCPU ÷ 2\)/u],
        ["vps_slot_decommission_not_lower", /fewer slots than the VPS has now/u],
        ["vps_slot_decommission_would_move", /never moves a server/u],
        ["vps_slot_decommission_relocation_inbound", /move onto this VPS/u],
        ["vps_slot_decommission_onboarding_incomplete", /retry its failed onboarding/u],
        ["vps_slot_decommission_onboarding_active", /still being onboarded/u],
        ["vps_slot_decommission_runner_not_current", /current runner revision/u],
        ["vps_slot_decommission_runner_update_active", /runner update in progress/u],
        ["vps_slot_decommission_slots_unsettled", /ready or assigned/u],
        ["vps_slot_decommission_relocation_active", /being relocated/u],
        ["vps_slot_decommission_plan_conflict", /Cancel that plan/u],
        ["vps_slot_decommission_state_inconsistent", /Open an incident/u],
        ["vps_slot_decommission_failed_use_retry", /Retry onboarding/u],
        ["vps_slot_decommission_committed", /can no longer be cancelled/u],
        ["vps_slot_decommission_recovery_conflict", /no higher than its lowest retired slot/u],
        ["vps_slot_decommission_not_resolvable", /cannot be resolved now/u],
        ["vps_slot_decommission_evidence_changed", /review it again before resolving/u],
        ["vps_slot_decommission_slot_not_kept", /not one this decommission keeps/u],
        ["vps_slot_decommission_assignment_changed", /Do not accept it; open an incident/u],
        ["vps_slot_decommission_resolutions_full", /as many resolutions as it can hold/u],
        ["vps_slot_decommission_onboarding_changed", /^The runner state changed since this page loaded. Refresh and review the current failure before resolving.$/u],
        ["vps_slot_decommission_plan_open", /checks a fresh plan only/u],
        ["vps_slot_decommission_preflight_failed", /preflight could not read the VPS/u],
        ["slot_catalog_decommission_in_progress", /only a raise revives them/u],
    ])("explains %s as an alert", (code, text) => {
        expect(notice(code)).toEqual({ tone: "error", text: expect.stringMatching(text) });
    });

    it.each([
        ["VPS slot decommission request conflicted", /different decommission under this request/u],
        ["VPS slot decommission cancel conflicted", /different cancel under this request/u],
        ["VPS slot decommission resolution conflicted", /different resolution under this request. Refresh the VPS list and resolve again/u],
        ["VPS host provider conflicted", /another provider/u],
    ])("explains the conflict %s", (message, text) => {
        expect(decommissionErrorNotice(new ControlPlaneAdminError("request_conflict", message))).toEqual({ tone: "error", text: expect.stringMatching(text) });
        expect(resolveErrorNotice(new ControlPlaneAdminError("request_conflict", message))).toEqual({ tone: "error", text: expect.stringMatching(text) });
    });

    it("shows the control plane's own message for anything else", () => {
        expect(notice("request_conflict")).toEqual({ tone: "error", text: "raw control plane text" });
        expect(decommissionErrorNotice("nope")).toEqual({ tone: "error", text: "The slot decommission could not be requested." });
    });

    it("reports a control plane without the resolution operation as a calm note", () => {
        expect(resolveErrorNotice(new ControlPlaneAdminError("invalid_request", "The control plane request is invalid.")))
            .toEqual({ tone: "note", text: expect.stringMatching(/cannot resolve kept slots yet/u) });
        expect(resolveErrorNotice(new ControlPlaneAdminError("unsupported_operation", "raw"))).toMatchObject({ tone: "note" });
        expect(resolveErrorNotice(new ControlPlaneAdminError("vps_slot_decommission_disabled", "raw"))).toMatchObject({ tone: "note" });
        expect(resolveErrorNotice(new ControlPlaneAdminError("vps_slot_decommission_not_resolvable", "raw")))
            .toEqual({ tone: "error", text: expect.stringMatching(/cannot be resolved now/u) });
        expect(resolveErrorNotice(new ControlPlaneAdminError("vps_slot_decommission_some_new_code", "A new refusal.")))
            .toEqual({ tone: "error", text: "A new refusal." });
    });

    it("explains a raise refused over an unsettled decommission", () => {
        expect(slotCapacityErrorMessage(new ControlPlaneAdminError("vps_slot_capacity_decommission_planned", "raw")))
            .toMatch(/unsettled slot decommission\. Cancel its decommission plan/u);
    });
});
