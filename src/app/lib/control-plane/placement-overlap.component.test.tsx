import { expect, it } from "vitest";
import {
    allBusyLabel,
    estimatedHistoryLabel,
    heatmapDigitProbability,
    hostOverlap,
    hostOverlapCellLabel,
    hostOverlapSummary,
    overlapBand,
    placementHostOverlapGroups,
    probabilityAtLeast,
    weekHourLabel,
} from "./placement-overlap";
import type { HostingPlacementHost, HostingPlacementServer } from "./types";

/** A heatmap from one digit per hour of the week, Monday 00:00 UTC first. */
const heatmap = (digit: (hour: number) => number) => Array.from({ length: 168 }, (_, hour) => String(digit(hour))).join("");
const allNine = heatmap(() => 9);
// Saturday and Sunday are hours 120–167.
const weekendNine = heatmap((hour) => hour >= 120 ? 9 : 2);

it("reads each heatmap digit as the midpoint of its online band", () => {
    expect([0, 4, 9].map(heatmapDigitProbability)).toEqual([0.05, 0.45, 0.95]);
});

it("matches hand-computed expected online counts and all-busy chances", () => {
    // Three servers almost always online on a three-slot VPS: 0.95 each.
    const full = hostOverlap(3, [allNine, allNine, allNine])!;
    expect(full.full).toBe(true);
    expect(full.expected).toHaveLength(168);
    expect(full.expected[0]).toBeCloseTo(2.85, 10);
    expect(full.allBusy[100]).toBeCloseTo(0.857375, 10);
    expect(full.allBusyHoursPerWeek).toBeCloseTo(0.857375 * 168, 8);
    expect(allBusyLabel(full, 3)).toBe("~144 h/wk all 3 busy");

    // Weekdays 0.25 each, weekends 0.95 each, on two slots.
    const weekend = hostOverlap(2, [weekendNine, weekendNine])!;
    expect(weekend.expected[0]).toBeCloseTo(0.5, 10);
    expect(weekend.allBusy[0]).toBeCloseTo(0.0625, 10);
    expect(weekend.expected[130]).toBeCloseTo(1.9, 10);
    expect(weekend.allBusy[130]).toBeCloseTo(0.9025, 10);
    expect(weekend.allBusyHoursPerWeek).toBeCloseTo(120 * 0.0625 + 48 * 0.9025, 8);
    expect(weekend.peakHour).toBe(120);
});

it("never counts a VPS with a free slot as all busy", () => {
    const partial = hostOverlap(3, [allNine, allNine])!;
    expect(partial.full).toBe(false);
    expect(partial.expected[5]).toBeCloseTo(1.9, 10);
    expect(partial.allBusy.every((chance) => chance === 0)).toBe(true);
    expect(partial.allBusyHoursPerWeek).toBe(0);
    const empty = hostOverlap(2, [])!;
    expect(empty.expected.every((count) => count === 0)).toBe(true);
    expect(empty.full).toBe(false);
});

it("has no overlap while a server on the VPS has no usable heatmap", () => {
    expect(hostOverlap(2, [allNine, "bad"])).toBeNull();
    expect(hostOverlap(2, [allNine, ""])).toBeNull();
});

it("computes the chance that at least some of several servers are online", () => {
    // Two of three even chances: three ways to have exactly two online, one to have all three.
    expect(probabilityAtLeast([0.5, 0.5, 0.5], 2)).toBeCloseTo(3 * 0.125 + 0.125, 10);
    expect(probabilityAtLeast([0.95, 0.95, 0.95], 3)).toBeCloseTo(0.857375, 10);
    expect(probabilityAtLeast([0.2, 0.3], 3)).toBe(0);
    expect(probabilityAtLeast([0.2, 0.3], 0)).toBe(1);
});

it("shades an hour by how much of the VPS's capacity is expected online", () => {
    expect(overlapBand(2.85, 3)).toBe(9);
    expect(overlapBand(3, 3)).toBe(9);
    expect(overlapBand(0, 3)).toBe(0);
    expect(overlapBand(1.5, 3)).toBe(5);
    expect(overlapBand(0.5, 2)).toBe(2);
    // 0.1 + 0.2 lands just under 0.3, but it is the start of the third band.
    expect(overlapBand(0.1 + 0.2, 1)).toBe(3);
    expect(overlapBand(1, 0)).toBe(0);
});

it("labels hours and summarizes a VPS's week", () => {
    expect(weekHourLabel(0)).toBe("Mon 00:00 UTC");
    expect(weekHourLabel(24 + 20)).toBe("Tue 20:00 UTC");
    expect(weekHourLabel(167)).toBe("Sun 23:00 UTC");
    const full = hostOverlap(3, [allNine, allNine, allNine])!;
    expect(hostOverlapCellLabel(full, 44, 3)).toBe("Tue 20:00 UTC · ~2.9 of 3 online · all 3 busy 86%");
    expect(hostOverlapSummary("vps-7e1cbd42", 3, 3, full)).toBe("vps-7e1cbd42: 3 of 3 slots; all busy about 144 hours a week; busiest Mon 00:00 UTC, about 2.9 online");
    const partial = hostOverlap(3, [allNine])!;
    expect(hostOverlapCellLabel(partial, 0, 3)).toBe("Mon 00:00 UTC · ~1.0 of 3 online");
    expect(hostOverlapSummary("vps-7e1cbd42", 3, 1, partial)).toBe("vps-7e1cbd42: 1 of 3 slots; 2 slots free; busiest Mon 00:00 UTC, about 1.0 online");
    expect(hostOverlapSummary("vps-empty", 2, 0, hostOverlap(2, [])!)).toBe("vps-empty: 0 of 2 slots; 2 slots free; no servers");
});

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

it("groups VPSs with more than one slot by region, on either side of the plan", () => {
    const plan = {
        model: { minimumObservedDays: 7 },
        servers: [server("raven", "Ravenclaw", allNine), server("brute", "Brute", allNine), server("dog", "The Dog House", allNine), server("solo", "Solo", allNine)],
        moves: [],
        hosts: [
            host("vps-uk", ["united-kingdom"], 2, ["solo"], ["solo"], 0, 0),
            host("vps-single", ["germany"], 1, ["solo"], ["solo"], 0, 0),
            host("vps-7e1cbd42", ["germany"], 3, ["raven", "brute", "dog"], ["brute"], 495, 0),
            host("vps-loose", [], 2, [], ["raven", "dog"], 0, 140),
        ],
    };
    const now = placementHostOverlapGroups(plan, "current");
    expect(now.map((group) => [group.region, group.rows.map((row) => row.host.serviceName)])).toEqual([
        ["Germany", ["vps-7e1cbd42"]], ["United Kingdom", ["vps-uk"]], ["No region", ["vps-loose"]],
    ]);
    const busy = now[0]!.rows[0]!;
    expect(busy.occupants.map((occupant) => occupant.displayName)).toEqual(["Ravenclaw", "Brute", "The Dog House"]);
    expect(busy).toMatchObject({ pairHoursPerWeek: 495, freeSlots: 0 });
    expect(busy.overlap!.allBusyHoursPerWeek).toBeCloseTo(144.04, 2);

    const after = placementHostOverlapGroups(plan, "proposed");
    expect(after[0]!.rows[0]!).toMatchObject({ pairHoursPerWeek: 0, freeSlots: 2, occupants: [{ serverId: "brute", displayName: "Brute" }] });
    expect(after[2]!.rows[0]!).toMatchObject({ pairHoursPerWeek: 140, freeSlots: 0 });
    // An unknown server has no heatmap, so its VPS has no overlap rather than a guess.
    expect(placementHostOverlapGroups({ ...plan, hosts: [host("vps-x", ["germany"], 2, ["raven", "gone"], [], 1, 0)] }, "current")[0]!.rows[0]!)
        .toMatchObject({ overlap: null, occupants: [{ displayName: "Ravenclaw" }, { displayName: "gone" }] });
});

it("notes servers with less history than the plan's minimum", () => {
    expect(estimatedHistoryLabel([], 7)).toBeNull();
    expect(estimatedHistoryLabel([{ displayName: "Game Night", observedDays: 0 }], 7)).toBe("Estimated: Game Night has no history yet");
    expect(estimatedHistoryLabel([{ displayName: "Game Night", observedDays: 3 }], 7)).toBe("Estimated: Game Night has under 7 days of history");
    expect(estimatedHistoryLabel([{ displayName: "Game Night", observedDays: 0 }, { displayName: "X", observedDays: 0 }], 7)).toBe("Estimated: Game Night, X have no history yet");
    expect(estimatedHistoryLabel([{ displayName: "Game Night", observedDays: 0 }, { displayName: "X", observedDays: 6.5 }], 10)).toBe("Estimated: Game Night, X have under 10 days of history");
    expect(estimatedHistoryLabel(["A", "B", "C", "D"].map((displayName) => ({ displayName, observedDays: 2 })), 7)).toBe("Estimated: 4 servers have under 7 days of history");
    expect(estimatedHistoryLabel([{ displayName: "A", observedDays: 0.5 }], 1)).toBe("Estimated: A has under 1 day of history");
});

it("ends an estimated VPS's summary and hour labels with the estimate", () => {
    const overlap = hostOverlap(2, [allNine, allNine])!;
    expect(hostOverlapCellLabel(overlap, 0, 2, true)).toBe("Mon 00:00 UTC · ~1.9 of 2 online · all 2 busy 90% · estimated");
    expect(hostOverlapSummary("vps-new", 2, 2, overlap, "Estimated: Game Night has no history yet"))
        .toBe("vps-new: 2 of 2 slots; all busy about 152 hours a week; busiest Mon 00:00 UTC, about 1.9 online. Estimated: Game Night has no history yet");
});

it("estimates each side of the plan from the plan's own minimum history", () => {
    const plan = {
        model: { minimumObservedDays: 7 },
        moves: [],
        servers: [server("night", "Game Night", allNine, 0), server("fresh", "Fresh Start", allNine, 3), server("old", "Old Guard", allNine, 28), server("vet", "Veteran", allNine, 7)],
        hosts: [
            host("vps-new", ["germany"], 2, ["night", "old"], ["old", "vet"], 50, 40),
            host("vps-mid", ["germany"], 2, ["fresh", "vet"], ["fresh", "night"], 30, 20),
        ],
    };
    const estimates = (side: "current" | "proposed", minimumObservedDays = 7) => Object.fromEntries(placementHostOverlapGroups({ ...plan, model: { minimumObservedDays } }, side)[0]!.rows
        .map((row) => [row.host.serviceName, row.estimate]));
    expect(estimates("current")).toEqual({ "vps-new": "Estimated: Game Night has no history yet", "vps-mid": "Estimated: Fresh Start has under 7 days of history" });
    // Veteran has exactly the minimum, so once Game Night leaves, vps-new is no estimate.
    expect(estimates("proposed")).toEqual({ "vps-new": null, "vps-mid": "Estimated: Fresh Start, Game Night have under 7 days of history" });
    expect(estimates("proposed", 30)).toEqual({ "vps-new": "Estimated: Old Guard, Veteran have under 30 days of history", "vps-mid": "Estimated: Fresh Start, Game Night have under 30 days of history" });
});
