import { describe, expect, it } from "vitest";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { sortVpsHosts } from "./vps-inventory-query";

describe("sortVpsHosts", () => {
    it("prioritizes unresolved errors and keeps settled and unknown updates in their original order", () => {
        const rolledBack = host("rolled-back", "succeeded", "failed", "runner_isolated_rolled_back");
        const recovered = host("recovered", "succeeded", "failed", "runner_isolated_applied_recovered");
        const unapplied = host("unapplied", "succeeded", "failed", "runner_update_not_applied");
        const healthy = host("healthy", "succeeded");
        const updateError = host("update-error", "succeeded", "failed", "runner_isolated_applied_recovery_incomplete");
        const onboardingError = host("onboarding-error", "failed", "failed", "runner_isolated_rolled_back");
        const unknown = host("unknown", "succeeded", "settled", "runner_isolated_rolled_back");
        const pending = host("pending", "running");
        const input = [rolledBack, healthy, recovered, updateError, unknown, onboardingError, pending, unapplied];

        expect(sortVpsHosts(input).map(({ name }) => name)).toEqual([
            "update-error",
            "onboarding-error",
            "rolled-back",
            "healthy",
            "recovered",
            "unknown",
            "pending",
            "unapplied",
        ]);
        expect(input[0]).toBe(rolledBack);
    });
});

function host(name: string, onboardingState: "succeeded" | "failed" | "running", updateState?: string, errorCode: string | null = null) {
    return {
        name,
        runnerOnboarding: { state: onboardingState },
        runnerUpdate: updateState === undefined ? null : { state: updateState, errorCode },
    } as HostingAdminVpsHost;
}
