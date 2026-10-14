import { describe, expect, it } from "vitest";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { sortVpsHosts } from "./vps-inventory-query";

describe("sortVpsHosts", () => {
    it("places terminal onboarding and update errors first while preserving the order of the rest", () => {
        const healthy = host("healthy", "succeeded");
        const updateError = host("update-error", "succeeded", "failed");
        const onboardingError = host("onboarding-error", "failed");
        const pending = host("pending", "running");
        const input = [healthy, updateError, onboardingError, pending];

        expect(sortVpsHosts(input).map(({ name }) => name)).toEqual([
            "update-error",
            "onboarding-error",
            "healthy",
            "pending",
        ]);
        expect(input.map(({ name }) => name)).toEqual(["healthy", "update-error", "onboarding-error", "pending"]);
    });
});

function host(name: string, onboardingState: "succeeded" | "failed" | "running", updateState?: "failed") {
    return {
        name,
        runnerOnboarding: { state: onboardingState },
        runnerUpdate: updateState === undefined ? null : { state: updateState },
    } as HostingAdminVpsHost;
}
