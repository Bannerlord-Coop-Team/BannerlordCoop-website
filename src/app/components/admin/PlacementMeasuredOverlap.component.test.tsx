import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import type { HostingAdminPlacementOverlap, HostingPlacementOverlapHost } from "@/app/lib/control-plane/types";
import { PlacementMeasuredOverlap } from "./PlacementMeasuredOverlap";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));

/** 168 hours from a function of the hour index. */
const week = <T,>(value: (hour: number) => T) => Array.from({ length: 168 }, (_, hour) => value(hour));

// The contract's example: a full two-slot VPS, both servers busy 21:00–23:00 on the last five days.
const busyHours = new Set([0, 1, 2, 3, 4].flatMap((day) => [(day + 2) * 24 + 20, (day + 2) * 24 + 21]));
const full: HostingPlacementOverlapHost = {
    serviceName: "vps-1a2b3c4d.vps.ovh.net", regionKeys: ["germany"], vCpu: 4, slots: 2,
    occupants: [
        { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Calradia Company", hoursWithData: 166 },
        { serverId: "33333333-3333-4333-8333-333333333333", displayName: "Sturgia Nights", hoursWithData: 120 },
    ],
    // The window's first two hours have no data at all.
    online: week((hour) => hour < 2 ? null : busyHours.has(hour) ? 2 : hour % 24 === 18 ? 1 : 0),
    allBusy: week((hour) => hour < 48 ? "-" : busyHours.has(hour) ? "1" : "0").join(""),
    allBusyHours: 10, measuredPairHours: 7.5, coverage: 0.714,
};
const half: HostingPlacementOverlapHost = {
    serviceName: "vps-uk-half.vps.ovh.net", regionKeys: ["united-kingdom"], vCpu: 6, slots: 3,
    occupants: [{ serverId: "44444444-4444-4444-8444-444444444444", displayName: "Lone Wolf", hoursWithData: 168 }],
    online: week(() => 0.5), allBusy: "-".repeat(168), allBusyHours: 0, measuredPairHours: 0, coverage: 1,
};
const empty: HostingPlacementOverlapHost = {
    serviceName: "vps-spare", regionKeys: [], vCpu: 4, slots: 2, occupants: [],
    online: week(() => null), allBusy: "-".repeat(168), allBusyHours: 0, measuredPairHours: 0, coverage: 0,
};
const overlap: HostingAdminPlacementOverlap = {
    generatedAt: "2026-10-19T00:07:31.552Z", windowStartedAt: "2026-10-12T00:00:00.000Z", windowEndedAt: "2026-10-19T00:00:00.000Z", hours: 168,
    hosts: [empty, half, full],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    mocks.request.mockResolvedValue(overlap);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

/** Opens the pane and lets its read on opening finish. */
async function open() {
    await act(async () => root.render(<PlacementMeasuredOverlap />));
    await settle();
}

async function settle() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function calls() {
    return mocks.request.mock.calls.map(([request]) => request as { operation: string; input: unknown });
}

function button(text: string) {
    return [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
}

function row(name: string) {
    return [...container.querySelectorAll("li")].find((item) => item.querySelector("p")?.textContent === name)!;
}

function strip(name: string) {
    return row(name).querySelector<HTMLElement>('[role="img"]')!;
}

/** A strip's shaded hours and, under a full VPS, its all-busy row. */
function cells(name: string) {
    const [shading, busy] = [...strip(name).children].map((line) => [...line.querySelectorAll<HTMLElement>(":scope > span > span")]);
    return { shading: shading!, busy };
}

it("reads the measured overlap once when it opens, with no dry run", async () => {
    await open();
    expect(calls()).toEqual([expect.objectContaining({ operation: "placement-overlap", input: {}, accessToken: "test-only" })]);
    expect(container.querySelector("h2")!.textContent).toBe("Host overlap");
    expect(container.textContent).toContain("Measured over the last 7 days");
    expect(container.textContent).toContain("Measured 12 Oct 00:00 – 19 Oct 00:00 UTC · generated");
    expect(container.querySelector('time[datetime="2026-10-19T00:07:31.552Z"]')).not.toBeNull();
    // Kept while the tab stays open: nothing reads it again by itself.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(calls()).toHaveLength(1);
});

it("groups VPSs by region with hosts without one last, and names each by its short service name", async () => {
    await open();
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual(["Germany", "United Kingdom", "No region"]);
    expect([...container.querySelectorAll("li")].map((item) => item.querySelector("p")!.textContent)).toEqual(["vps-1a2b3c4d", "vps-uk-half", "vps-spare"]);
    expect(row("vps-1a2b3c4d").querySelector("p")!.getAttribute("title")).toBe("vps-1a2b3c4d.vps.ovh.net");
    expect(row("vps-1a2b3c4d").textContent).toContain("2 slots");
    expect(row("vps-1a2b3c4d").textContent).toContain("Calradia Company, Sturgia Nights");
});

it("labels the window's real UTC dates, not a typical week", async () => {
    await open();
    const axis = container.querySelector("h3 + div")!;
    expect([...axis.children].map((day) => day.textContent)).toEqual(["Mon 12 Oct", "Tue 13 Oct", "Wed 14 Oct", "Thu 15 Oct", "Fri 16 Oct", "Sat 17 Oct", "Sun 18 Oct"]);
    const shading = cells("vps-1a2b3c4d").shading;
    expect(shading).toHaveLength(168);
    expect(shading[2 * 24 + 20]!.getAttribute("title")).toBe("Wed 14 Oct 20:00 UTC · 2 of 2 online · all busy");
    expect(shading[3 * 24 + 18]!.getAttribute("title")).toBe("Thu 15 Oct 18:00 UTC · 1 of 2 online · not all busy");
    expect(shading[30]!.getAttribute("title")).toBe("Tue 13 Oct 06:00 UTC · 0 of 2 online · all busy unknown (a server has no data)");
});

it("draws hours without data apart from hours nobody was online", async () => {
    await open();
    const shading = cells("vps-1a2b3c4d").shading;
    // Hour 0 has no data; hour 2 was measured with nobody online.
    expect(shading[0]!.getAttribute("title")).toBe("Mon 12 Oct 00:00 UTC · no data");
    expect(shading[0]!.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(shading[0]!.className).not.toMatch(/bg-gold/u);
    expect(shading[2]!.className).toContain("bg-gold/10");
    expect(shading[2]!.style.backgroundImage).toBe("");
    expect(shading[2 * 24 + 20]!.classList.contains("bg-gold")).toBe(true);
    expect(container.textContent).toContain("No data");
});

it("marks a full VPS's all-busy hours and draws unknown ones apart from measured ones", async () => {
    await open();
    const busy = cells("vps-1a2b3c4d").busy!;
    expect(busy).toHaveLength(168);
    expect(busy.flatMap((cell, hour) => cell.classList.contains("bg-crimson") ? [hour] : [])).toEqual([...busyHours].sort((a, b) => a - b));
    // '-' (a server without data) is hatched; '0' is measured and plainly not all busy.
    expect(busy[10]!.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(busy[50]!.className).toContain("bg-white/10");
    expect(busy[50]!.style.backgroundImage).toBe("");
    expect(row("vps-1a2b3c4d").textContent).toContain("10 h all busy");
    expect(row("vps-1a2b3c4d").textContent).toContain("7.5 pair-h measured");
    expect(row("vps-1a2b3c4d").textContent).toContain("71% measured");
    expect(strip("vps-1a2b3c4d").getAttribute("aria-label")).toBe("vps-1a2b3c4d: 2 of 2 slots; all busy 10 hours in the week; busiest Wed 14 Oct 20:00 UTC, 2 online; 71% measured");
});

it("says a VPS with a free slot is not full, and an empty one is empty", async () => {
    await open();
    expect(cells("vps-uk-half").busy).toBeUndefined();
    expect(row("vps-uk-half").textContent).toContain("Not full");
    expect(row("vps-uk-half").textContent).toContain("Lone Wolf");
    expect(cells("vps-uk-half").shading[0]!.getAttribute("title")).toBe("Mon 12 Oct 00:00 UTC · 0.5 of 3 online · not full");
    expect(strip("vps-uk-half").getAttribute("aria-label")).toBe("vps-uk-half: 1 of 3 slots; not full; busiest Mon 12 Oct 00:00 UTC, 0.5 online; 100% measured");
    expect(row("vps-spare").textContent).toContain("Empty");
    expect(row("vps-spare").textContent).toContain("Not full");
    expect(row("vps-spare").textContent).toContain("0% measured");
    expect(strip("vps-spare").getAttribute("aria-label")).toBe("vps-spare: 0 of 2 slots; empty");
    expect(cells("vps-spare").shading.every((cell) => cell.style.backgroundImage.includes("repeating-linear-gradient"))).toBe(true);
});

it("shows a loading state, then refreshes on request without stacking reads", async () => {
    let finish: ((value: unknown) => void) | null = null;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await open();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading measured overlap…");
    expect(button("Refresh").disabled).toBe(true);
    await act(async () => finish!(overlap));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(button("Refresh").disabled).toBe(false);

    await act(async () => button("Refresh").click());
    expect(calls()).toHaveLength(2);
    expect(container.querySelector("li")).not.toBeNull();
});

it.each([
    [new ControlPlaneAdminError("rate_limited", "Too many requests.", true), "You can read the measured overlap six times every five minutes. Wait a few minutes, then refresh."],
    [new ControlPlaneAdminError("invalid_request", "Invalid request.", false), "This control plane does not report measured overlap yet."],
    [new ControlPlaneAdminError("placement_history_unavailable", "Host overlap history is unavailable.", true), "Host overlap history is unavailable."],
] as const)("explains a failed read and retries it: %s", async (error, message) => {
    mocks.request.mockRejectedValueOnce(error);
    await open();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe(`${message} Retry`);
    expect(container.querySelector("li")).toBeNull();
    await act(async () => button("Retry").click());
    await settle();
    expect(calls()).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(row("vps-1a2b3c4d")).toBeDefined();
});

it("keeps what it showed when a refresh fails, and rejects a malformed read", async () => {
    await open();
    mocks.request.mockRejectedValueOnce(new ControlPlaneAdminError("rate_limited", "Too many requests.", true));
    await act(async () => button("Refresh").click());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("six times every five minutes");
    expect(row("vps-1a2b3c4d")).toBeDefined();

    mocks.request.mockResolvedValueOnce({ ...overlap, hours: 24 });
    await act(async () => button("Retry").click());
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("The control plane returned an unexpected host overlap. Retry");
});

it.each([
    ["19:00", ["12", "Tue 13 Oct", "Wed 14 Oct", "Thu 15 Oct", "Fri 16 Oct", "Sat 17 Oct", "Sun 18 Oct", "Mon 19 Oct"]],
    ["16:00", ["12 Oct", "Tue 13 Oct", "Wed 14 Oct", "Thu 15 Oct", "Fri 16 Oct", "Sat 17 Oct", "Sun 18 Oct", "Mon 19 Oct"]],
    // A two-hour sliver shows no text but keeps its date in its title.
    ["22:00", ["", "Tue 13 Oct", "Wed 14 Oct", "Thu 15 Oct", "Fri 16 Oct", "Sat 17 Oct", "Sun 18 Oct", "Mon 19 Oct"]],
] as const)("labels every date of a window starting at %s UTC, short ones in short", async (start, labels) => {
    mocks.request.mockResolvedValueOnce({ ...overlap, windowStartedAt: `2026-10-12T${start}:00.000Z`, windowEndedAt: `2026-10-19T${start}:00.000Z` });
    await open();
    const axis = container.querySelector("h3 + div")!;
    expect([...axis.children].map((day) => day.textContent)).toEqual(labels);
    expect([...axis.children].map((day) => day.getAttribute("title"))).toEqual(["Mon 12 Oct", "Tue 13 Oct", "Wed 14 Oct", "Thu 15 Oct", "Fri 16 Oct", "Sat 17 Oct", "Sun 18 Oct", "Mon 19 Oct"]);
    expect(cells("vps-1a2b3c4d").shading[0]!.getAttribute("title")).toBe(`Mon 12 Oct ${start} UTC · no data`);
});
