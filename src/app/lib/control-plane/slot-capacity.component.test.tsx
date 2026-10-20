import { describe, expect, it } from "vitest";
import { ControlPlaneAdminError } from "./client";
import {
    parseRaiseVpsSlotCapacityResult,
    slotCapacityErrorMessage,
    slotCapacityInput,
    slotCapacityRaisable,
    slotCapacityResultMessage,
} from "./slot-capacity";

const REQUEST = { provider: "ovhcloud-vps" as const, serviceName: "vps-a1b2c3d4.vps.ovh.us", slotCapacity: 5 };
const RAISED = {
    outcome: "raised",
    provider: "ovhcloud-vps",
    serviceName: "vps-a1b2c3d4.vps.ovh.us",
    vCpu: 4,
    previousSlotCapacity: 2,
    slotCapacity: 5,
    runnerOnboarding: {
        state: "queued", progressStage: "slot-capacity-raised", errorCode: null,
        sourceCommit: "a".repeat(40), updatedAt: "2026-10-20T12:05:00.000Z",
    },
};

describe("the slot capacity raise result", () => {
    it("accepts exactly a raised or unchanged result for the requested host and capacity", () => {
        expect(parseRaiseVpsSlotCapacityResult(RAISED, REQUEST)).toEqual(RAISED);
        const unchanged = { ...RAISED, outcome: "unchanged", previousSlotCapacity: 5 };
        expect(parseRaiseVpsSlotCapacityResult(unchanged, REQUEST)).toEqual(unchanged);
        // Only an unchanged host that was never onboarded has no onboarding.
        expect(parseRaiseVpsSlotCapacityResult({ ...unchanged, runnerOnboarding: null }, REQUEST))
            .toMatchObject({ runnerOnboarding: null });
        // A raised capacity may exceed the vCPUs: a slot reserves no cores.
        expect(parseRaiseVpsSlotCapacityResult({ ...RAISED, vCpu: 2, previousSlotCapacity: 1, slotCapacity: 32 },
            { ...REQUEST, slotCapacity: 32 })).toMatchObject({ slotCapacity: 32 });
    });

    it.each([
        ["another host", { serviceName: "vps-other.vps.ovh.us" }],
        ["another provider", { provider: "contabo-vps" }],
        ["another capacity", { slotCapacity: 6 }],
        ["an unknown outcome", { outcome: "lowered" }],
        ["a raise that did not grow", { previousSlotCapacity: 5 }],
        ["an unchanged result that grew", { outcome: "unchanged" }],
        ["a previous capacity below floor(vCPU / 2)", { vCpu: 8, previousSlotCapacity: 2 }],
        ["a fractional vCPU count", { vCpu: 4.5 }],
        ["a raise without an onboarding", { runnerOnboarding: null }],
        ["an unknown onboarding state", { runnerOnboarding: { ...RAISED.runnerOnboarding, state: "paused" } }],
        ["a malformed source commit", { runnerOnboarding: { ...RAISED.runnerOnboarding, sourceCommit: "main" } }],
        ["an extra onboarding key", { runnerOnboarding: { ...RAISED.runnerOnboarding, hostPublicKey: "ssh-ed25519 x" } }],
        ["an extra key", { slots: [] }],
    ])("rejects %s", (_label, change) => {
        expect(parseRaiseVpsSlotCapacityResult({ ...RAISED, ...change }, REQUEST)).toBeNull();
    });

    it("rejects anything that is not an object", () => {
        for (const value of [null, undefined, "raised", 5, [RAISED]]) expect(parseRaiseVpsSlotCapacityResult(value, REQUEST)).toBeNull();
    });

    it("says what changed", () => {
        expect(slotCapacityResultMessage(parseRaiseVpsSlotCapacityResult(RAISED, REQUEST)!))
            .toMatch(/^Raised from 2 to 5 slots\. .*current servers keep running\.$/u);
        expect(slotCapacityResultMessage({ ...parseRaiseVpsSlotCapacityResult(RAISED, REQUEST)!, outcome: "unchanged", previousSlotCapacity: 5 }))
            .toBe("This VPS already has 5 slots; nothing changed.");
    });
});

describe("the slot capacity form", () => {
    it("takes a whole number above the current capacity and at most 32", () => {
        expect(slotCapacityInput(" 6 ", 3)).toEqual({ slotCapacity: 6 });
        expect(slotCapacityInput("32", 31)).toEqual({ slotCapacity: 32 });
        expect(slotCapacityInput("3", 3)).toEqual({ error: "Choose more than the 3 slots this VPS has now; a capacity is never lowered." });
        expect(slotCapacityInput("1", 1)).toEqual({ error: "Choose more than the 1 slot this VPS has now; a capacity is never lowered." });
        expect(slotCapacityInput("33", 3)).toEqual({ error: "A VPS holds at most 32 slots." });
        for (const value of ["", "4.5", "-4", "1e1", "six", "100"]) expect(slotCapacityInput(value, 3)).toHaveProperty("error");
    });

    it("allows a raise only after onboarding succeeded and below 32 slots", () => {
        const onboarding = { ...RAISED.runnerOnboarding, state: "succeeded" as const };
        expect(slotCapacityRaisable({ runnerOnboarding: onboarding, totalSlots: 3 })).toBe(true);
        expect(slotCapacityRaisable({ runnerOnboarding: onboarding, totalSlots: 32 })).toBe(false);
        expect(slotCapacityRaisable({ runnerOnboarding: { ...onboarding, state: "running" }, totalSlots: 3 })).toBe(false);
        expect(slotCapacityRaisable({ runnerOnboarding: null, totalSlots: 3 })).toBe(false);
    });

    it("explains each refusal in the words an administrator acts on", () => {
        expect(slotCapacityErrorMessage(new ControlPlaneAdminError("vps_slot_capacity_disabled", "raw")))
            .toMatch(/switched off.*HOSTING_DYNAMIC_SLOT_CAPACITY/u);
        expect(slotCapacityErrorMessage(new ControlPlaneAdminError("vps_slot_capacity_shrink", "raw"))).toMatch(/never lowered/u);
        expect(slotCapacityErrorMessage(new ControlPlaneAdminError("vps_slot_capacity_runner_not_current", "raw")))
            .toMatch(/current runner revision/u);
        expect(slotCapacityErrorMessage(new ControlPlaneAdminError("request_conflict", "VPS slot capacity request conflicted")))
            .toBe("VPS slot capacity request conflicted");
        expect(slotCapacityErrorMessage("nope")).toBe("The slot capacity could not be raised.");
    });
});
