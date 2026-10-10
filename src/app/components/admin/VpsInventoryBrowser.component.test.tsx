import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import {
    VPS_PAGE_SIZE_STORAGE_KEY,
    filterVpsHosts,
    readVpsPageSize,
    setRememberedVpsPageSize,
    summarizeVpsSlots,
    vpsOwnerEmails,
    vpsRegionOptions,
} from "@/app/lib/control-plane/vps-inventory-query";
import type { WebsiteAccountSummary } from "@/app/lib/supabase/users";
import { VpsInventoryBrowser } from "./VpsInventoryBrowser";

vi.mock("@/app/components/admin/RunnerOnboardingStatus", () => ({
    RunnerOnboardingStatus: () => <span>Runner current</span>,
}));

const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CARA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const accounts: WebsiteAccountSummary[] = [
    { accountId: ADA, label: "ada@example.com", email: "ada@example.com", discordUserId: null },
    { accountId: BEA, label: "bea@example.com", email: "Bea@Example.com", discordUserId: null },
    { accountId: CARA, label: "cara@example.com", email: "cara@example.com", discordUserId: "123456789012345678" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    localStorage.clear();
    setRememberedVpsPageSize(10);
    localStorage.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
});

describe("VPS inventory filters", () => {
    it("pages registered hosts and stores the chosen page size", async () => {
        await render(numberedHosts(12));
        expect(visibleNames()).toEqual(numberedNames(1, 10));
        expect(container.textContent).toContain("Showing 1–10 of 12");
        expect(container.textContent).toContain("Page 1 of 2");
        expect(pageSizeSelect().value).toBe("10");
        expect(button("Previous").disabled).toBe(true);

        await act(async () => button("Next").click());
        expect(visibleNames()).toEqual(["vps-11", "vps-12"]);
        expect(container.textContent).toContain("Showing 11–12 of 12");
        expect(button("Next").disabled).toBe(true);

        await act(async () => button("Previous").click());
        expect(visibleNames()).toEqual(numberedNames(1, 10));

        await choosePageSize("25");
        expect(pageSizeSelect().value).toBe("25");
        expect(localStorage.getItem(VPS_PAGE_SIZE_STORAGE_KEY)).toBe("25");
        expect(visibleNames()).toEqual(numberedNames(1, 12));
        expect(container.textContent).toContain("Page 1 of 1");
    });

    it("restores a stored page size on the next visit", async () => {
        localStorage.setItem(VPS_PAGE_SIZE_STORAGE_KEY, "50");
        await render(numberedHosts(12));
        expect(pageSizeSelect().value).toBe("50");
        expect(visibleNames()).toHaveLength(12);
    });

    it("ignores a stored page size outside 10, 25, 50, and 100", async () => {
        localStorage.setItem(VPS_PAGE_SIZE_STORAGE_KEY, "15");
        await render(numberedHosts(11));
        expect(pageSizeSelect().value).toBe("10");
        expect(visibleNames()).toEqual(numberedNames(1, 10));
        expect([...pageSizeSelect().options].map((option) => option.value)).toEqual(["10", "25", "50", "100"]);
    });

    it("filters by several regions, owner email, and empty slots", async () => {
        const hosts = [
            host("ada-east", "us-east", 1, ADA),
            host("ada-france", "france", 0, ADA),
            host("bea-france", "france", 2, BEA),
            host("open-germany", "germany", 3, null),
            host("custom-region", "orbit-1", 1, ADA),
        ];
        await render(hosts);
        expect(container.textContent).toContain("All regions");
        expect(regionBox("orbit-1")).not.toBeNull();

        await act(async () => regionBox("france")!.click());
        expect(visibleNames()).toEqual(["ada-france", "bea-france"]);
        expect(container.textContent).toContain("2 of 5 VPS match these filters.");
        await act(async () => regionBox("us-east")!.click());
        expect(visibleNames()).toEqual(["ada-east", "ada-france", "bea-france"]);

        await typeEmail("bea");
        expect(suggestionButtons().map((suggestion) => suggestion.textContent)).toEqual(["Bea@Example.com"]);
        await act(async () => suggestionButtons()[0]!.click());
        expect(emailInput().value).toBe("Bea@Example.com");
        expect(visibleNames()).toEqual(["bea-france"]);

        await typeEmail("");
        await act(async () => emptySlotsBox().click());
        expect(visibleNames()).toEqual(["ada-east", "bea-france"]);
        expect(container.textContent).not.toContain("ada-france");
        expect(container.textContent).not.toContain("open-germany");
    });

    it("returns to the first page when a filter changes", async () => {
        await render(numberedHosts(12));
        await act(async () => button("Next").click());
        expect(container.textContent).toContain("vps-11");
        await act(async () => regionBox("us-east")!.click());
        expect(container.textContent).toContain("Page 1 of 2");
        expect(container.textContent).not.toContain("vps-11");
        expect(visibleNames()[0]).toBe("vps-01");
    });

    it("says when every host is filtered out and keeps the empty fleet message separate", async () => {
        await render([host("full-east", "us-east", 0, ADA)]);
        await act(async () => emptySlotsBox().click());
        expect(container.textContent).toContain("No VPS hosts match these filters.");
        expect(container.textContent).toContain("Showing 0 VPS");
        expect(container.textContent).not.toContain("No registered OVH VPS hosts.");

        await act(async () => root.render(<VpsInventoryBrowser hosts={[]} accounts={accounts} ownerLabels={{}} runnerTargetSourceCommit={null} />));
        expect(container.textContent).toContain("No registered OVH VPS hosts.");
        expect(container.textContent).not.toContain("Rows per page");
        expect(container.textContent).not.toContain("Only show VPS with empty slots");
    });
});

describe("VPS inventory query", () => {
    it("matches a slot owner by account id or legacy Discord id", () => {
        const hosts = [
            host("ada-host", "us-west", 1, ADA.toUpperCase()),
            host("cara-host", "poland", 0, null, "123456789012345678"),
            host("unknown-host", "poland", 1, null, "999999999999999999"),
        ];
        expect(vpsOwnerEmails(hosts, accounts)).toEqual(["ada@example.com", "cara@example.com"]);
        expect(filterVpsHosts(hosts, accounts, { regions: ["poland"], email: "CARA@", emptySlotsOnly: false }).map((item) => item.name)).toEqual(["cara-host"]);
        expect(filterVpsHosts(hosts, accounts, { regions: [], email: "", emptySlotsOnly: true }).map((item) => item.name)).toEqual(["ada-host", "unknown-host"]);
        expect(vpsRegionOptions(hosts).map((option) => option.label)).toEqual(["US-West", "Poland"]);
        expect(summarizeVpsSlots([
            ...hosts,
            host("empty-region", "", 0, null),
            host("later-east", "us-east", 2, ADA),
        ])).toMatchObject({
            totalSlots: 15,
            takenSlots: 4,
            regions: [
                { region: "us-west", label: "US-West", totalSlots: 3, takenSlots: 1 },
                { region: "us-east", label: "US-East", totalSlots: 3, takenSlots: 1 },
                { region: "poland", label: "Poland", totalSlots: 6, takenSlots: 2 },
                { region: "unknown", label: "unknown", totalSlots: 3, takenSlots: 0 },
            ],
        });
        expect(readVpsPageSize({ getItem: () => "100" })).toBe(100);
        expect(readVpsPageSize({ getItem: () => "10abc" })).toBe(10);
        expect(readVpsPageSize({ getItem: () => { throw new Error("blocked"); } })).toBe(10);
    });
});

function render(hosts: HostingAdminVpsHost[]) {
    return act(async () => root.render(
        <VpsInventoryBrowser hosts={hosts} accounts={accounts} ownerLabels={{}} runnerTargetSourceCommit={null} />,
    ));
}

function numberedHosts(count: number) {
    return Array.from({ length: count }, (_, index) => host(`vps-${String(index + 1).padStart(2, "0")}`, "us-east", 1, ADA));
}

function numberedNames(start: number, end: number) {
    return Array.from({ length: end - start + 1 }, (_, index) => `vps-${String(start + index).padStart(2, "0")}`);
}

function visibleNames() {
    return [...container.querySelectorAll("section[role='rowgroup'] p.font-mono")].map((node) => node.textContent);
}

function pageSizeSelect() {
    const select = container.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("Missing page size select");
    return select;
}

function button(label: string) {
    const match = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
    if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing ${label} button`);
    return match;
}

function regionBox(value: string) {
    return container.querySelector<HTMLInputElement>(`input[name="region"][value="${value}"]`);
}

function emptySlotsBox() {
    const label = [...container.querySelectorAll("label")].find((item) => item.textContent === "Only show VPS with empty slots");
    const input = label?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing empty-slot checkbox");
    return input;
}

function emailInput() {
    const input = container.querySelector('input[type="search"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing email filter");
    return input;
}

function suggestionButtons() {
    return [...container.querySelectorAll<HTMLButtonElement>('[role="listbox"] button')];
}

async function typeEmail(value: string) {
    const input = emailInput();
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function choosePageSize(value: string) {
    const select = pageSizeSelect();
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

function host(name: string, region: string, availableServers: number, ownerAccountId: string | null, ownerDiscordUserId = ownerAccountId ?? "owner-missing"): HostingAdminVpsHost {
    return {
        name,
        locationId: "location",
        region,
        totalSlots: 3,
        runningServers: availableServers === 0 ? 1 : 0,
        availableServers,
        occupiedSlots: ownerAccountId === null && ownerDiscordUserId === "owner-missing" ? [] : [{
            slotIndex: 0,
            gamePort: 4200,
            serverId: `${name}-server`,
            displayName: name,
            ownerDiscordUserId,
            ownerAccountId,
            operationState: "stopped",
        }],
        cost: null,
        expirationDate: null,
        autoRenew: null,
        providerCheckedAt: null,
        resources: null,
        runnerOnboarding: null,
    };
}
