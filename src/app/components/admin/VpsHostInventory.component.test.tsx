import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostingAdminHostResources, HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { diskPressureLevel, VpsHostInventory } from "./VpsHostInventory";

vi.mock("@/app/components/admin/RunnerOnboardingStatus", () => ({
    RunnerOnboardingStatus: ({ compact }: { compact?: boolean }) => <button type="button">{compact ? "Runner current" : "Runner details"}</button>,
}));

const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

describe("compact VPS host inventory", () => {
    it.each([
        { autoRenew: true, expirationDate: "2026-11-01T00:00:00.000Z", status: "Renews 11/01/2026" },
        { autoRenew: false, expirationDate: "2026-11-01T00:00:00.000Z", status: "Won't Renew" },
        { autoRenew: false, expirationDate: null, status: "Won't Renew" },
        { autoRenew: null, expirationDate: "2026-11-01T00:00:00.000Z", status: "Renewal unknown" },
        { autoRenew: true, expirationDate: null, status: "Renewal date unknown" },
        { autoRenew: true, expirationDate: "not-a-date", status: "Renewal date unknown" },
    ])("shows $status beneath the price in a collapsed row", async ({ autoRenew, expirationDate, status }) => {
        await act(async () => root.render(<VpsHostInventory
            hosts={[{ ...host("host-billing", resources(60, 40), 0), autoRenew, expirationDate }]}
            ownerLabels={{}}
            runnerTargetSourceCommit={null}
        />));

        const billing = container.querySelector('[role="cell"][data-label="Billing"]');
        expect([...billing!.querySelectorAll("p")].map(line => line.textContent)).toEqual(["$12.32 / month", status]);
        expect(container.querySelector('[role="region"]')).toBeNull();
    });

    it("keeps summaries compact and reveals only one host detail panel at a time", async () => {
        await act(async () => root.render(<VpsHostInventory
            hosts={[host("host-a", resources(70, 30), 0, true), host("host-b", resources(80, 20), 1)]}
            ownerLabels={{ [ACCOUNT_ID]: "owner@example.com" }}
            runnerTargetSourceCommit="target-source"
        />));

        expect(container.textContent).toContain("host-a");
        expect(container.textContent).toContain("owner@example.com (testserver)");
        const capacity = container.querySelector('dl[aria-label="3 total slots, 1 running, 2 free"]');
        expect(capacity?.querySelectorAll("dt")).toHaveLength(3);
        expect(capacity?.textContent).toBe("Slots3Running1Free2");
        expect(container.textContent).not.toContain("UDP 4200");
        expect([...container.querySelectorAll("button")].filter((button) => button.textContent === "Runner current")).toHaveLength(2);

        const firstToggle = container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-a"]')!;
        await act(async () => firstToggle.click());
        expect(firstToggle.getAttribute("aria-expanded")).toBe("true");
        expect(container.textContent).toContain("Slot 1 · UDP 4200");
        expect(container.textContent).toContain("owner@example.com");
        expect(container.textContent).toContain("Player / Server");
        expect(container.textContent).toContain("Target target-sourc");
        expect(container.textContent).toContain("Verifying Capabilities");
        const slotTable = container.querySelector('[role="table"][aria-label="Occupied slots for host-a"]');
        expect(slotTable).not.toBeNull();
        expect(slotTable?.textContent?.indexOf("owner@example.com")).toBeLessThan(slotTable?.textContent?.indexOf("testserver") ?? 0);

        const secondToggle = container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-b"]')!;
        await act(async () => secondToggle.click());
        expect(container.querySelector('button[aria-label="Expand details for host-a"]')).not.toBeNull();
        expect(container.textContent).toContain("Slot 2 · UDP 4201");
        expect(container.textContent).not.toContain("Slot 1 · UDP 4200");
        expect(container.querySelector('[role="table"][aria-label="VPS host inventory"]')).not.toBeNull();
    });

    it("labels a host by the stored catalog regions its country and zone satisfy", async () => {
        const stored = [
            { region: "us-east", placement: { countryCodes: ["US"], locationIds: ["os-us-east-va-2"] } },
            { region: "us-west", placement: { countryCodes: ["US"], locationIds: ["us-west-or"] } },
            { region: "north-america", placement: { countryCodes: ["US", "CA"] } },
        ];
        await act(async () => root.render(<VpsHostInventory hosts={[host("host-a", resources(60, 40), 0)]} ownerLabels={{}}
            runnerTargetSourceCommit={null} regionCatalog={stored} />));
        expect(container.textContent).toContain("US-East, North America · US · os-us-east-va-2");
        await act(async () => root.render(<VpsHostInventory hosts={[host("host-a", resources(60, 40), 0)]} ownerLabels={{}}
            runnerTargetSourceCommit={null} regionCatalog={null} />));
        expect(container.textContent).toContain("Regions unavailable · US · os-us-east-va-2");
    });

    it("surfaces disk warning state in a collapsed row", async () => {
        await act(async () => root.render(<VpsHostInventory
            hosts={[host("host-warning", resources(82, 18), 0)]}
            ownerLabels={{}}
            runnerTargetSourceCommit="target-source"
        />));

        const disk = container.querySelector('[aria-label="Disk warning: 82% used, 18 KiB free"]');
        expect(disk).not.toBeNull();
        expect(disk?.textContent).toContain("82% · 18 KiB free");
        expect(container.textContent).not.toContain("UDP 4200");
    });

    it("uses the bound account email for a legacy numeric owner", async () => {
        await act(async () => root.render(<VpsHostInventory
            hosts={[host("host-email", resources(60, 40), 0)]}
            ownerLabels={{ [ACCOUNT_ID]: "owner@example.com" }}
            runnerTargetSourceCommit="target-source"
        />));

        expect(container.textContent).toContain("owner@example.com (testserver)");
        expect(container.textContent).not.toContain("763278507085922325");
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-email"]')!.click());
        expect(container.querySelector('[aria-label="Occupied slots for host-email"]')?.textContent).toContain("owner@example.com");
        expect(container.textContent).not.toContain("763278507085922325");
    });
});

describe("disk pressure presentation", () => {
    it.each([
        [74, 26, "normal"],
        [79, 21, "normal"],
        [80, 20, "warning"],
        [89, 11, "warning"],
        [90, 10, "critical"],
        [100, 0, "critical"],
    ] as const)("classifies %i used and %i free as %s", (used, free, level) => {
        expect(diskPressureLevel(resources(used, free))).toEqual({ level, usedPercent: used });
    });

    it("rejects unavailable and invalid totals", () => {
        expect(diskPressureLevel(null)).toBeNull();
        expect(diskPressureLevel({ ...resources(0, 0), diskTotalBytes: 0 })).toBeNull();
        expect(diskPressureLevel(resources(-1, 101))).toBeNull();
    });

    it("uses the reported filesystem capacity rather than inferring it from free space", () => {
        expect(diskPressureLevel({ ...resources(80, 10), diskTotalBytes: 100 * 1024 })).toEqual({
            level: "warning",
            usedPercent: 80,
        });
    });
});

function host(name: string, hostResources: HostingAdminHostResources, slotIndex: number, updating = false): HostingAdminVpsHost {
    return {
        name,
        locationId: "os-us-east-va-2",
        countryCode: "US",
        region: null,
        totalSlots: 3,
        runningServers: 1,
        availableServers: 2,
        occupiedSlots: [{
            slotIndex,
            gamePort: 4200 + slotIndex,
            serverId: `server-${slotIndex}`,
            displayName: slotIndex === 0 ? "testserver" : "Joke's Cool Server",
            ownerDiscordUserId: "763278507085922325",
            ownerAccountId: ACCOUNT_ID,
            operationState: "running",
            resources: {
                observedAt: "2026-09-10T18:00:00.000Z",
                sampleDurationMs: 250,
                cpuVcpus: 1.16,
                cpuLimitVcpus: 2,
                memoryUsedBytes: 1_352_917_606,
                memoryLimitBytes: 3_221_225_472,
            },
        }],
        cost: { priceInMicrocents: 1_232_000_000, currencyCode: "USD", duration: "P1M", interval: 1 },
        expirationDate: "2027-08-30T20:52:00.000Z",
        autoRenew: true,
        providerCheckedAt: "2026-09-10T18:00:00.000Z",
        resources: hostResources,
        runnerOnboarding: { state: "succeeded", progressStage: "runner-active", errorCode: null, sourceCommit: "target-source", updatedAt: "2026-09-10T18:00:00.000Z" },
        runnerUpdate: updating ? {
            state: "running",
            progressStage: "verifying-capabilities",
            errorCode: null,
            targetSourceCommit: "target-source",
            priorSourceCommit: "prior-source",
            updatedAt: "2026-09-10T18:00:00.000Z",
        } : null,
    };
}

function resources(used: number, free: number): HostingAdminHostResources {
    return {
        observedAt: "2026-09-10T18:00:00.000Z",
        uptimeSeconds: 900_000,
        cpuPercent: 47.7,
        memoryUsedBytes: 2_791_728_742,
        memoryTotalBytes: 12_240_000_000,
        diskUsedBytes: used * 1024,
        diskFreeBytes: free * 1024,
        diskTotalBytes: 100 * 1024,
    };
}
