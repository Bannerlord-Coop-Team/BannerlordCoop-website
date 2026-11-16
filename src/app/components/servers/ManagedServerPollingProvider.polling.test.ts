import { describe, expect, it } from "vitest";
import { isTerminalManagedServerOperationState, managedServerEffectivePollDelay } from "./ManagedServerPollingProvider";

describe("managed server polling policy", () => {
    it("keeps the base interval at or above fifteen seconds and backs off", () => {
        expect(managedServerEffectivePollDelay(0)).toBe(15_000);
        expect(managedServerEffectivePollDelay(0, 1)).toBe(30_000);
        expect(managedServerEffectivePollDelay(10 * 60_000)).toBe(240_000);
    });

    it("recognizes terminal server states", () => {
        expect(isTerminalManagedServerOperationState("stopped")).toBe(true);
        expect(isTerminalManagedServerOperationState("deleted")).toBe(true);
        expect(isTerminalManagedServerOperationState("starting")).toBe(false);
        expect(isTerminalManagedServerOperationState(null)).toBe(false);
    });
});
