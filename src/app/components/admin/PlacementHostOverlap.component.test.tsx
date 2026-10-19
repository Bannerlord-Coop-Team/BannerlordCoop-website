import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { PlacementOverlapPlan } from "@/app/lib/control-plane/placement-overlap";
import type { HostingPlacementHost, HostingPlacementServer } from "@/app/lib/control-plane/types";
import { PlacementHostOverlap } from "./PlacementHostOverlap";

const heatmap = (digit: (hour: number) => number) => Array.from({ length: 168 }, (_, hour) => String(digit(hour))).join("");
const allNine = heatmap(() => 9);
// Saturday and Sunday (hours 120–167) at 0.95, weekdays at 0.25.
const weekends = heatmap((hour) => hour >= 120 ? 9 : 2);

function server(serverId: string, displayName: string, heatmapValue: string, observedDays = 28): HostingPlacementServer {
    return {
        serverId, displayName, region: "germany", serviceName: "vps-a", proposedServiceName: "vps-a", pinnedReason: null, observedDays,
        weeklyOnlineHours: 100, heatmap: heatmapValue,
        quietWindow: { weekday: "sunday", startsAtUtc: "03:00", durationMinutes: 120, onlineProbability: 0.1, nextStartsAt: "2026-10-25T03:00:00.000Z" },
    };
}

function host(serviceName: string, regionKeys: string[], slots: number, current: string[], proposed: string[], pairHours: number, proposedPairHours: number): HostingPlacementHost {
    const side = (serverIds: string[], pairHoursPerWeek: number) => ({ serverIds, pairHoursPerWeek, contendedHoursPerWeek: 0, saturatedHoursPerWeek: 0, observedPairHoursPerWeek: 0, peakExpectedOnline: 0 });
    return { serviceName, regionKeys, vCpu: 4, slots, freeSlots: slots - current.length, acceptsRelocations: true, current: side(current, pairHours), proposed: side(proposed, proposedPairHours) };
}

// Today's busiest VPS: three servers that are nearly always online, of which the plan leaves only Brute.
const plan: PlacementOverlapPlan = {
    model: { minimumObservedDays: 7 },
    servers: [
        server("raven", "Ravenclaw", allNine), server("brute", "Brute", allNine), server("dog", "The Dog House", allNine),
        server("sat", "Saturday Club", weekends), server("sun", "Sunday Club", weekends), server("solo", "Solo", allNine), server("new", "Newcomer", "bad"),
    ],
    moves: [],
    hosts: [
        host("vps-uk-weekend", ["united-kingdom"], 2, ["sat", "sun"], ["sat", "raven"], 120, 60),
        host("vps-single", ["germany"], 1, ["solo"], ["solo"], 0, 0),
        host("vps-7e1cbd42", ["germany"], 3, ["raven", "brute", "dog"], ["brute"], 495, 0),
        host("vps-de-new", ["germany"], 2, ["new"], ["new", "dog"], 0, 12),
    ],
};

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

async function render(shown: PlacementOverlapPlan = plan) {
    await act(async () => root.render(<PlacementHostOverlap plan={shown} />));
}

function hostRow(serviceName: string) {
    return [...container.querySelectorAll("li")].find((item) => item.querySelector("p")?.textContent === serviceName) ?? null;
}

function strip(serviceName: string) {
    return container.querySelector<HTMLElement>(`[role="img"][aria-label^="${serviceName}:"]`);
}

// The shaded hours and, under a full VPS, the marker row.
function cells(serviceName: string) {
    const [shading, markers] = [...strip(serviceName)!.children].map((row) => [...row.querySelectorAll(":scope > span > span")]);
    return { shading: shading!, markers };
}

function button(text: string) {
    return [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;
}

it("shows only VPSs with more than one slot, grouped by region", async () => {
    await render();
    expect(container.querySelector("h2")!.textContent).toBe("Host overlap");
    expect(container.textContent).toContain("When are a VPS's slots busy at the same time?");
    expect(hostRow("vps-single")).toBeNull();
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual(["Germany", "United Kingdom"]);
    expect([...container.querySelectorAll("li")].map((item) => item.querySelector("p")!.textContent)).toEqual(["vps-7e1cbd42", "vps-de-new", "vps-uk-weekend"]);

    const busy = hostRow("vps-7e1cbd42")!;
    expect(busy.textContent).toContain("3 slots");
    expect(busy.textContent).toContain("Ravenclaw, Brute, The Dog House");
    expect(busy.textContent).toContain("495.0 pair-h/wk");
    expect(busy.textContent).toContain("~144 h/wk all 3 busy");
    expect(hostRow("vps-de-new")!.textContent).toContain("Unavailable: a server on this VPS has no learned weekly activity yet.");
    expect(hostRow("vps-de-new")!.textContent).toContain("1 slot free");
});

it("shades 168 hours by expected occupancy and marks only the full VPS's mostly all-busy hours", async () => {
    await render();
    const busy = cells("vps-7e1cbd42");
    expect(busy.shading).toHaveLength(168);
    // 2.85 of 3 expected online is the top band in every hour.
    expect(busy.shading.every((cell) => cell.classList.contains("bg-gold"))).toBe(true);
    expect(busy.markers!.filter((cell) => cell.classList.contains("bg-crimson"))).toHaveLength(168);
    expect(busy.shading[44]!.getAttribute("title")).toBe("Tue 20:00 UTC · ~2.9 of 3 online · all 3 busy 86%");

    const weekend = cells("vps-uk-weekend");
    // Weekdays: 0.5 of 2 online is band 2 (the 20–30% shade); weekends: 1.9 of 2 is the top band.
    expect(weekend.shading.slice(0, 120).every((cell) => cell.classList.contains("bg-gold/30"))).toBe(true);
    expect(weekend.shading.slice(120).every((cell) => cell.classList.contains("bg-gold"))).toBe(true);
    // Both online is 6% on weekdays and 90% at weekends, so only weekend hours are marked.
    const marked = weekend.markers!.flatMap((cell, hour) => cell.classList.contains("bg-crimson") ? [hour] : []);
    expect(marked).toEqual(Array.from({ length: 48 }, (_, index) => 120 + index));
    expect(weekend.shading[0]!.getAttribute("title")).toBe("Mon 00:00 UTC · ~0.5 of 2 online · all 2 busy 6%");
});

it("summarizes each strip for assistive technology", async () => {
    await render();
    expect(strip("vps-7e1cbd42")!.getAttribute("aria-label")).toBe("vps-7e1cbd42: 3 of 3 slots; all busy about 144 hours a week; busiest Mon 00:00 UTC, about 2.9 online");
    expect(strip("vps-uk-weekend")!.getAttribute("aria-label")).toBe("vps-uk-weekend: 2 of 2 slots; all busy about 51 hours a week; busiest Sat 00:00 UTC, about 1.9 online");
    expect(strip("vps-de-new")).toBeNull();
});

it("switches between the current placement and the plan's", async () => {
    await render();
    expect(button("Now").getAttribute("aria-pressed")).toBe("true");
    expect(button("After plan").getAttribute("aria-pressed")).toBe("false");

    await act(async () => button("After plan").click());
    expect(button("Now").getAttribute("aria-pressed")).toBe("false");
    expect(button("After plan").getAttribute("aria-pressed")).toBe("true");
    const busy = hostRow("vps-7e1cbd42")!;
    expect(busy.textContent).toContain("Brute");
    expect(busy.textContent).not.toContain("Ravenclaw");
    expect(busy.textContent).toContain("0.0 pair-h/wk");
    expect(busy.textContent).toContain("2 slots free");
    expect(busy.textContent).not.toContain("all 3 busy");
    // With a free slot there is no marker row, and the hours say so.
    expect(cells("vps-7e1cbd42").markers).toBeUndefined();
    expect(cells("vps-7e1cbd42").shading[0]!.getAttribute("title")).toBe("Mon 00:00 UTC · ~1.0 of 3 online");
    expect(strip("vps-7e1cbd42")!.getAttribute("aria-label")).toBe("vps-7e1cbd42: 1 of 3 slots; 2 slots free; busiest Mon 00:00 UTC, about 1.0 online");
    expect(hostRow("vps-uk-weekend")!.textContent).toContain("Saturday Club, Ravenclaw");
    expect(hostRow("vps-uk-weekend")!.textContent).toContain("60.0 pair-h/wk");

    await act(async () => button("Now").click());
    expect(hostRow("vps-7e1cbd42")!.textContent).toContain("~144 h/wk all 3 busy");
});

it("marks a VPS as an estimate while a server on it has less than the plan's minimum history", async () => {
    // Game Night has no history at all and Fresh Start three days: the control plane fills their weeks from the fleet's.
    await render({
        model: { minimumObservedDays: 7 },
        moves: [],
        servers: [server("night", "Game Night", allNine, 0), server("fresh", "Fresh Start", weekends, 3), server("old", "Old Guard", allNine, 28), server("vet", "Veteran", allNine, 7)],
        hosts: [
            host("vps-new", ["germany"], 2, ["night", "old"], ["old", "vet"], 50, 40),
            host("vps-mid", ["germany"], 2, ["fresh", "vet"], ["fresh", "night"], 30, 20),
        ],
    });
    expect(hostRow("vps-new")!.textContent).toContain("Estimated: Game Night has no history yet");
    expect(strip("vps-new")!.getAttribute("aria-label")).toBe("vps-new: 2 of 2 slots; all busy about 152 hours a week; busiest Mon 00:00 UTC, about 1.9 online. Estimated: Game Night has no history yet");
    expect(cells("vps-new").shading.every((cell) => cell.getAttribute("title")!.endsWith(" · estimated"))).toBe(true);
    expect(hostRow("vps-mid")!.textContent).toContain("Estimated: Fresh Start has under 7 days of history");
    expect(strip("vps-mid")!.getAttribute("aria-label")).toMatch(/\. Estimated: Fresh Start has under 7 days of history$/u);
    expect(cells("vps-mid").shading[0]!.getAttribute("title")).toBe("Mon 00:00 UTC · ~1.2 of 2 online · all 2 busy 24% · estimated");

    // After the plan Game Night joins Fresh Start, and vps-new holds only servers with the minimum history.
    await act(async () => button("After plan").click());
    expect(hostRow("vps-new")!.textContent).not.toContain("Estimated");
    expect(strip("vps-new")!.getAttribute("aria-label")).not.toContain("Estimated");
    expect(cells("vps-new").shading.some((cell) => cell.getAttribute("title")!.includes("estimated"))).toBe(false);
    expect(hostRow("vps-mid")!.textContent).toContain("Estimated: Fresh Start, Game Night have under 7 days of history");
});

it("marks nothing as an estimate when every server has the minimum history", async () => {
    await render();
    expect(container.textContent).not.toContain("Estimated");
    expect(cells("vps-7e1cbd42").shading.some((cell) => cell.getAttribute("title")!.includes("estimated"))).toBe(false);
});

it("explains the scale and the marker in words, not colour alone", async () => {
    await render();
    expect(container.textContent).toContain("Each strip is one week from Monday, UTC, one cell per hour. Expected online:");
    expect(container.textContent).toContain("all slots");
    expect(container.textContent).toContain("All slots busy (≥ 50%), on the thin row under a full VPS");
});

it("says so when no VPS can be shared", async () => {
    await act(async () => root.render(<PlacementHostOverlap plan={{ ...plan, hosts: [plan.hosts[1]!] }} />));
    expect(container.textContent).toContain("No VPS in the plan has more than one slot, so no two servers share one.");
    expect(container.querySelector("li")).toBeNull();
});
