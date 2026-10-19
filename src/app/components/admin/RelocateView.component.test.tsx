import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { relocationRows, relocationTargets } from "@/app/lib/control-plane/relocation";
import type { HostingAdminVpsHost, HostingJob, ManagedServer, RelocateViewData } from "@/app/lib/control-plane/types";
import { RelocateView } from "./RelocateView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: mocks.request, ControlPlaneAdminError: class extends Error {} }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const catalog = [
    { region: "france", placement: { countryCodes: ["FR"] } },
    { region: "united-kingdom", placement: { countryCodes: ["GB"] } },
    { region: "germany", placement: { countryCodes: ["DE"] } },
];

function server(serverId: string, displayName: string, friendlyRegion: string): ManagedServer {
    return {
        serverId, displayName, friendlyRegion, ownerDiscordUserId: "123456789012345678", ownerAccountId: null,
        provider: "ovhcloud-vps", providerResourceId: null, providerLocationId: null, desiredState: "running",
        observedVmState: "running", observedGameState: "running", operationState: "running", releaseChannel: "stable",
        installedBuildId: null, desiredBuildId: null, pinnedBuildId: null, maintenanceSlot: "sunday-0400", activeSaveId: null,
        connectionHostname: null, connectionIp: null, gamePorts: [], deletionDueAt: null, lastHealthCheckAt: null,
        lastErrorCode: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
    };
}

function host(name: string, countryCode: string, availableServers: number, occupied: Array<[string, number]>): HostingAdminVpsHost {
    return {
        provider: "ovhcloud-vps", name, countryCode, locationId: `${countryCode.toLowerCase()}-1`, region: null, totalSlots: 3, runningServers: occupied.length,
        availableServers, cost: null, expirationDate: null, autoRenew: null, providerCheckedAt: null, resources: null, runnerOnboarding: null,
        occupiedSlots: occupied.map(([serverId, slotIndex]) => ({
            serverId, slotIndex, gamePort: 4200 + slotIndex, displayName: serverId, ownerDiscordUserId: "123456789012345678", operationState: "running",
        })),
    };
}

function job(serverId: string, action: string, state = "running"): HostingJob {
    return {
        jobId: `${serverId}-${action}`, serverId, action, state, authority: "administrator", attemptCount: 1, maximumAttempts: 3,
        progressStage: "running", errorCode: null, runAt: "2026-10-16T12:00:00.000Z", createdAt: "2026-10-16T12:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
    };
}

const hosts = [
    host("vps-uk-a", "GB", 0, [["gang", 1], ["knights", 2]]),
    host("vps-fr-a", "FR", 1, [["boys", 0]]),
    host("vps-fr-b", "FR", 0, []),
    host("vps-de-a", "DE", 0, [["march", 0]]),
];
const data: RelocateViewData = {
    servers: { items: [server("gang", "The Gang", "united-kingdom"), server("knights", "Calradian Knights", "united-kingdom"), server("boys", "Dem Boys", "france")], nextCursor: null },
    inventory: { hosts, controlPlaneHost: null, availableHosts: [] },
    regionCatalog: catalog,
    activeJobs: [job("knights", "migrate-region"), job("boys", "backup")],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    mocks.request.mockResolvedValue({ outcome: "enqueued", job: job("gang", "migrate-region", "queued") });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

function row(name: string) {
    return [...container.querySelectorAll("tbody tr")].find((item) => item.textContent?.includes(name))!;
}

function button(scope: ParentNode, text: string) {
    return [...scope.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
}

async function select(element: HTMLSelectElement, value: string) {
    await act(async () => {
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

it("places each server on its VPS slot and keeps relocations ahead of other active jobs", () => {
    const rows = relocationRows(data.servers.items, hosts, [...data.activeJobs, job("knights", "backup")]);
    expect(rows.map(({ server: { serverId }, hostName, slotIndex, regionLabel, activeJob }) => ({ serverId, hostName, slotIndex, regionLabel, action: activeJob?.action ?? null }))).toEqual([
        { serverId: "gang", hostName: "vps-uk-a", slotIndex: 1, regionLabel: "United Kingdom", action: null },
        { serverId: "knights", hostName: "vps-uk-a", slotIndex: 2, regionLabel: "United Kingdom", action: "migrate-region" },
        { serverId: "boys", hostName: "vps-fr-a", slotIndex: 0, regionLabel: "France", action: "backup" },
    ]);
});

it("offers other hosts by catalog region, with full regions and hosts marked", () => {
    expect(relocationTargets(hosts, catalog, "vps-uk-a")).toEqual([
        { region: "france", label: "France", freeSlots: 1, hosts: [{ name: "vps-fr-a", freeSlots: 1 }, { name: "vps-fr-b", freeSlots: 0 }] },
        { region: "germany", label: "Germany", freeSlots: 0, hosts: [{ name: "vps-de-a", freeSlots: 0 }] },
    ]);
    expect(relocationTargets(hosts, catalog, "vps-fr-a").map((target) => target.region)).toEqual(["france", "united-kingdom", "germany"]);
});

it("disables Relocate while a server is already relocating or another job is running", async () => {
    await act(async () => root.render(<RelocateView data={data} query="" accounts={[]} />));

    expect(button(row("Calradian Knights"), "Relocate").disabled).toBe(true);
    expect(row("Calradian Knights").textContent).toContain("Relocating");
    expect(button(row("Dem Boys"), "Relocate").disabled).toBe(true);
    expect(button(row("Dem Boys"), "Relocate").title).toBe("Waiting for the backup job to finish.");
    expect(button(row("The Gang"), "Relocate").disabled).toBe(false);
});

it("queues a relocation from the pop-up and keeps the table on the page", async () => {
    await act(async () => root.render(<RelocateView data={data} query="" accounts={[]} />));
    await act(async () => button(row("The Gang"), "Relocate").click());

    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("vps-uk-a · slot 1");
    expect(dialog.textContent).toContain("The server will be stopped and moved. Its IP address will change.");
    const [regionSelect, hostSelect] = dialog.querySelectorAll("select");
    expect(regionSelect!.value).toBe("france");
    expect([...regionSelect!.options].find((option) => option.value === "germany")!.disabled).toBe(true);
    expect([...hostSelect!.options].find((option) => option.value === "vps-fr-b")!.disabled).toBe(true);
    await select(hostSelect!, "vps-fr-a");

    await act(async () => button(dialog, "Relocate").click());

    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({
        accessToken: "test-only",
        operation: "relocate-server",
        input: { serverId: "gang", expectedUpdatedAt: "2026-10-16T12:00:00.000Z", targetRegion: "france", targetServiceName: "vps-fr-a" },
    });
    expect(container.querySelector("dialog")).toBeNull();
    expect(row("The Gang").textContent).toContain("Relocating");
    expect(button(row("The Gang"), "Relocate").disabled).toBe(true);
    expect(mocks.refresh).toHaveBeenCalled();
});

it("sends a null VPS for any free slot and keeps the pop-up open with the error on failure", async () => {
    mocks.request.mockRejectedValueOnce(new Error("No free slot is available in France."));
    await act(async () => root.render(<RelocateView data={data} query="" accounts={[]} />));
    await act(async () => button(row("The Gang"), "Relocate").click());
    const dialog = container.querySelector("dialog")!;

    await act(async () => button(dialog, "Relocate").click());

    expect(mocks.request.mock.calls[0]?.[0].input.targetServiceName).toBeNull();
    expect(container.querySelector("dialog")).not.toBeNull();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("No free slot is available in France.");
});
