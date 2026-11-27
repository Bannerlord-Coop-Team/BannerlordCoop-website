import { act } from "react";
import { readFileSync } from "node:fs";
import { decodeControlPlaneAdminResponse } from "@/app/lib/control-plane/client";
import { parseSlotAvailability } from "@/app/lib/control-plane/slot-availability";
import shared from "../../../../test/fixtures/slot-storage/v1.json";
import capture from "../../../../test/fixtures/slot-storage/capture-v1.json";
import { readSlotStorage } from "@/app/lib/control-plane/slot-storage";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostingAdminHostResources, HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { diskPressureLevel, VpsHostInventory } from "./VpsHostInventory";

vi.mock("@/app/components/admin/RunnerOnboardingStatus", () => ({
    RunnerOnboardingStatus: ({ compact }: { compact?: boolean }) => <button type="button">{compact ? "Runner current" : "Runner details"}</button>,
}));
vi.mock("@/app/components/admin/VpsSlotCapacityRaise", () => ({
    VpsSlotCapacityRaise: ({ host, onRefresh }: { host: { name: string; totalSlots: number }; onRefresh?: () => void }) => (
        <form aria-label={`Raise the slot capacity of ${host.name}`} data-total-slots={host.totalSlots} data-refresh={onRefresh ? "parent" : "router"} />
    ),
}));
vi.mock("@/app/components/admin/VpsSlotDecommission", () => ({
    VpsSlotDecommission: ({ host, onRefresh }: { host: { name: string }; onRefresh?: () => void }) => (
        <form aria-label={`Decommission slots of ${host.name}`} data-refresh={onRefresh ? "parent" : "router"} />
    ),
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
    it("renders Slots, Running and Free for the shared incident fixture", async () => {
        const fixture = JSON.parse(readFileSync("test/fixtures/vps-slot-availability/v1.json", "utf8"));
        const requestId = "11111111-1111-4111-8111-111111111111";
        const result = decodeControlPlaneAdminResponse<{ hosts: HostingAdminVpsHost[] }>(JSON.stringify({
            version: 1, requestId, ok: true, result: { hosts: [{ ...host("fixture-host", resources(60, 40), 0), ...fixture.expectedHost }] },
        }), requestId, true);
        const details = result.hosts[0].slotAvailability!;
        expect(parseSlotAvailability(details)).toEqual(details);
        await act(async () => root.render(<VpsHostInventory hosts={result.hosts} ownerLabels={{}} runnerTargetSourceCommit={null} />));
        expect(container.querySelector('dl[aria-label="8 total slots, 0 running, 0 free"]')?.textContent)
            .toBe("Slots8Running0Free0");
        expect(container.textContent).not.toContain("Storage evidence is stale");
        const capacity = container.querySelector('[data-label="Capacity"]')!;
        expect(capacity.textContent).not.toMatch(/Admissible|Ready|launch-proven|relocation candidates/);
        expect(capacity.querySelector('dl')?.classList.contains('max-w-28')).toBe(true);
        for (const invalid of [{ reasons: ["unknown"] }, { ready: 33 }, { launchProven: 6 }, { extra: true }]) {
            expect(parseSlotAvailability({ ...details, ...invalid })).toBeUndefined();
        }
    });
    it.each([
        ["host_memory", "Host memory evidence is missing, stale, or below the admission minimum."],
        ["shared_image_commission", "Shared game image commissioning holds admission."],
        ["slot_health", "Slot health checks hold admission."],
    ])("keeps the capacity view compact for %s", async (reason, label) => {
        const requestId = "11111111-1111-4111-8111-111111111111";
        const result = decodeControlPlaneAdminResponse<{ hosts: HostingAdminVpsHost[] }>(JSON.stringify({
            version: 1, requestId, ok: true, result: { hosts: [{ ...host("blocked-host", resources(60, 40), 0),
                totalSlots: 8, runningServers: 0, availableServers: 0, provenServers: 0,
                slotAvailability: { ready: 5, launchProven: 2, storageObservedAt: "2026-11-11T03:32:28.000Z", reasons: [reason] },
            }] },
        }), requestId, true);
        expect(parseSlotAvailability(result.hosts[0].slotAvailability)).toEqual(result.hosts[0].slotAvailability);
        await act(async () => root.render(<VpsHostInventory hosts={result.hosts} ownerLabels={{}} runnerTargetSourceCommit={null} />));
        expect(container.querySelector('dl[aria-label="8 total slots, 0 running, 0 free"]')?.textContent)
            .toBe("Slots8Running0Free0");
        expect(container.textContent).not.toContain(label);
    });

    it("keeps free capacity visible when a future reason makes optional details unreadable", async () => {
        const details = { ready: 5, launchProven: 2, storageObservedAt: null, reasons: ["host_memory", "future_gate"] };
        for (const reason of ["future_gate", "host-memory", "SLOT_HEALTH", "shared_image_commission_extra"]) {
            expect(parseSlotAvailability({ ...details, reasons: [reason] })).toBeUndefined();
        }
        expect(parseSlotAvailability(details)).toBeUndefined();
        const requestId = "11111111-1111-4111-8111-111111111111";
        const result = decodeControlPlaneAdminResponse<{ hosts: HostingAdminVpsHost[] }>(JSON.stringify({
            version: 1, requestId, ok: true, result: { hosts: [{ ...host("future-host", resources(60, 40), 0),
                totalSlots: 8, runningServers: 0, availableServers: 0, slotAvailability: details,
            }] },
        }), requestId, true);
        await act(async () => root.render(<VpsHostInventory hosts={result.hosts} ownerLabels={{}} runnerTargetSourceCommit={null} />));
        expect(container.querySelector('dl[aria-label="8 total slots, 0 running, 0 free"]')?.textContent)
            .toBe("Slots8Running0Free0");
        expect(container.textContent).toContain("future-host");
        expect(container.textContent).not.toContain("future_gate");
    });
    it("decodes and renders the captured CP HTTP/IPC response and rejects an incompatible envelope", async () => {
        const decoded = decodeControlPlaneAdminResponse<{ hosts: HostingAdminVpsHost[] }>(JSON.stringify(capture), capture.requestId, true);
        await act(async () => root.render(<VpsHostInventory hosts={decoded.hosts} ownerLabels={{}} runnerTargetSourceCommit={null} />));
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
        expect(container.querySelector('[data-label="Storage"]')?.textContent).toBe(shared.cases[0]!.text);
        expect(() => decodeControlPlaneAdminResponse(JSON.stringify({ ...capture, version: 99 }), capture.requestId, true)).toThrow();
    });

    it.each(shared.cases)("consumes shared v1 storage case $name through the real decoder and table", async ({ storage, text, tone }) => {
        expect(shared.schemaVersion).toBe(1);
        const inventoryHost = host("host-storage", resources(60, 40), 0);
        inventoryHost.occupiedSlots[0]!.storage = storage;
        const decoded = decodeControlPlaneAdminResponse<{ hosts: HostingAdminVpsHost[] }>(JSON.stringify({
            version: 1, requestId: shared.requestId, ok: true, result: { hosts: [inventoryHost] },
        }), shared.requestId, true);
        await act(async () => root.render(<VpsHostInventory hosts={decoded.hosts} ownerLabels={{}} runnerTargetSourceCommit={null} />));
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-storage"]')!.click());
        const cell = container.querySelector('[data-label="Storage"]');
        expect(cell?.textContent).toBe(text);
        expect(cell?.querySelector("p")?.classList.contains(tone)).toBe(true);
        expect(container.querySelectorAll('[aria-label="Occupied slots for host-storage"] [role="columnheader"]')).toHaveLength(6);
    });

    it.each(shared.invalidStorage)("rejects incompatible storage: %j", storage => {
        expect(readSlotStorage(storage)).toBeNull();
    });

    it.each([
        { storage: undefined, pending: false, text: "Unknown" },
        { storage: shared.usedOnly, pending: false, text: "2.1 GiB" },
        { storage: shared.cases[0]!.storage, pending: true, text: "Loading…" },
    ])("renders storage $text for missing limits, older peers and pending reads", async ({ storage, pending, text }) => {
        const inventoryHost = host("host-storage", resources(60, 40), 0);
        inventoryHost.occupiedSlots[0]!.storage = storage;
        await act(async () => root.render(<VpsHostInventory hosts={[inventoryHost]} ownerLabels={{}} runnerTargetSourceCommit={null} liveDataPending={pending} />));
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-storage"]')!.click());
        expect(container.querySelector('[data-label="Storage"]')?.textContent).toBe(text);
    });

    it("renders healthy hosts beside a timed-out host and retains its inventory", async () => {
        const timedOut: HostingAdminVpsHost = { ...host("host-frozen", resources(60, 40), 1),
            resources: null, liveData: { status: "unavailable", reason: "timeout" } };
        await act(async () => root.render(<VpsHostInventory hosts={[host("host-healthy", resources(60, 40), 0), timedOut]}
            ownerLabels={{}} runnerTargetSourceCommit={null} />));
        expect(container.textContent).toContain("host-healthy");
        expect(container.textContent).toContain("host-frozen");
        expect(container.textContent).toContain("Live readings timed out.");
        expect(container.querySelectorAll('[data-label="Capacity"]')).toHaveLength(2);
        expect(container.querySelectorAll('[data-label="System"]')[0]?.textContent).toContain("CPU");
        expect(container.textContent).not.toContain("Loading");
    });
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

    it.each([
        ["runner_isolated_rolled_back", "settled"],
        ["runner_isolated_applied_recovery_incomplete", "failed"],
    ] as const)("shows %s as %s in expanded runner details", async (errorCode, state) => {
        const row = host("host-a", resources(70, 30), 0, true);
        row.runnerUpdate = { ...row.runnerUpdate!, state: "failed", progressStage: "failed", errorCode };
        await act(async () => root.render(<VpsHostInventory hosts={[row]} ownerLabels={{}} runnerTargetSourceCommit={null} />));
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-a"]')!.click());
        const details = container.querySelector('[role="region"][aria-label="Details for host-a"]');
        expect(details?.textContent).toContain(`Latest update ${state}`);
        expect(details?.textContent).toContain(errorCode);
        if (state === "settled") expect(details?.textContent).not.toMatch(/latest update failed| · Failed/iu);
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
        expect(container.querySelector('[data-label="Capacity"]')?.textContent).not.toMatch(/Admissible|Ready|launch-proven/);
        expect(container.textContent).toContain("2 available");
        expect(container.textContent).not.toContain("UDP 4200");
        expect([...container.querySelectorAll("button")].filter((button) => button.textContent === "Runner current")).toHaveLength(2);

        const firstToggle = container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-a"]')!;
        await act(async () => firstToggle.click());
        expect(firstToggle.getAttribute("aria-expanded")).toBe("true");
        // The slot capacity raise, and the slot decommission controls beside it, sit in the open host's details only.
        expect([...container.querySelectorAll("form")].map((form) => form.getAttribute("aria-label")))
            .toEqual(["Raise the slot capacity of host-a", "Decommission slots of host-a"]);
        expect(container.querySelector('form[aria-label="Decommission slots of host-a"]')?.getAttribute("data-refresh")).toBe("router");
        expect(container.querySelector('[role="region"][aria-label="Details for host-a"] form[aria-label="Decommission slots of host-a"]')).not.toBeNull();
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

    it("keeps same-named hosts of different providers as separate rows that expand independently", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            await act(async () => root.render(<VpsHostInventory
                hosts={[host("shared-name", resources(70, 30), 0), { ...host("shared-name", resources(80, 20), 1), provider: "contabo-vps" }]}
                ownerLabels={{}}
                runnerTargetSourceCommit={null}
            />));

            const toggles = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Expand details for shared-name"]')];
            expect(toggles).toHaveLength(2);
            await act(async () => toggles[1]!.click());
            expect(toggles.map(toggle => toggle.getAttribute("aria-expanded"))).toEqual(["false", "true"]);
            expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
            expect(container.textContent).toContain("Slot 2 · UDP 4201");
            expect(container.textContent).not.toContain("Slot 1 · UDP 4200");
            expect(errors.mock.calls.flat().join(" ")).not.toContain("same key");
        } finally {
            errors.mockRestore();
        }
    });

    it("labels a host by the stored catalog regions its country and zone satisfy", async () => {
        const stored = [
            { region: "us-east", placement: { countryCodes: ["US"], locationIds: ["os-us-east-va-2"] } },
            { region: "us-west", placement: { countryCodes: ["US"], locationIds: ["us-west-or"] } },
            { region: "north-america", placement: { countryCodes: ["US", "CA"] } },
        ];
        await act(async () => root.render(<VpsHostInventory hosts={[host("host-a", resources(60, 40), 0)]} ownerLabels={{}}
            runnerTargetSourceCommit={null} regionCatalog={stored} />));
        expect(container.textContent).toContain("OVHcloud · US-East, North America · US · os-us-east-va-2");
        await act(async () => root.render(<VpsHostInventory hosts={[host("host-a", resources(60, 40), 0)]} ownerLabels={{}}
            runnerTargetSourceCommit={null} regionCatalog={null} />));
        expect(container.textContent).toContain("Regions unavailable · US · os-us-east-va-2");
    });

    it("names a manual-entry provider in the host's placement label", async () => {
        const stored = [{ region: "turkiye", placement: { countryCodes: ["TR"] } }];
        const istanbul: HostingAdminVpsHost = { ...host("vpstc-ist-1", resources(60, 40), 0), provider: "vpstc-vps", countryCode: "TR", locationId: "ist" };
        await act(async () => root.render(<VpsHostInventory hosts={[istanbul]} ownerLabels={{}} runnerTargetSourceCommit={null} regionCatalog={stored} />));
        expect(container.textContent).toContain("VPS.TC · Türkiye · TR · ist");
        expect(container.textContent).not.toContain("vpstc-vps");
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
        provider: "ovhcloud-vps",
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

it("uses neutral suspended wording when slot desired state is unavailable", async () => {
    const value = host("sleep-host", resources(60, 40), 0);
    value.occupiedSlots[0].operationState = "suspended";
    await act(async () => root.render(<VpsHostInventory hosts={[value]} ownerLabels={{}} runnerTargetSourceCommit={null} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for sleep-host"]')!.click());
    expect(container.textContent).toContain("Suspended (sleeping or hold)");
    expect(container.textContent).not.toContain("Sleeping — wakes when a player connects");
    expect(container.innerHTML).not.toContain("Check its subscription or administrator notice");
});
