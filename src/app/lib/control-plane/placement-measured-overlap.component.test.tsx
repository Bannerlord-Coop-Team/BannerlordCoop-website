import { expect, it } from "vitest";
import { ControlPlaneAdminError } from "./client";
import {
    overlapBand,
    overlapDayAxisLabel,
    overlapDays,
    overlapGroups,
    overlapHourLabel,
    overlapWindowLabel,
    parsePlacementOverlap,
    placementOverlapErrorMessage,
} from "./placement-measured-overlap";

/** A copy of a record without one key. */
function without<T extends object>(value: T, key: keyof T) {
    const copy = { ...value };
    delete copy[key];
    return copy;
}

const week = <T,>(value: (hour: number) => T) => Array.from({ length: 168 }, (_, hour) => value(hour));
const host = {
    serviceName: "vps-1a2b3c4d.vps.ovh.net", regionKeys: ["germany"], vCpu: 4, slots: 2,
    occupants: [
        { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Calradia Company", hoursWithData: 166 },
        { serverId: "33333333-3333-4333-8333-333333333333", displayName: "Sturgia Nights", hoursWithData: 120 },
    ],
    online: week((hour) => hour < 2 ? null : hour % 24 === 20 ? 2 : 0.25),
    allBusy: week((hour) => hour < 48 ? "-" : hour % 24 === 20 ? "1" : "0").join(""),
    allBusyHours: 5, measuredPairHours: 7.5, coverage: 0.714,
};
const overlap = {
    generatedAt: "2026-10-19T00:07:31.552Z", windowStartedAt: "2026-10-12T00:00:00.000Z", windowEndedAt: "2026-10-19T00:00:00.000Z", hours: 168,
    hosts: [host, { ...host, serviceName: "vps-spare", regionKeys: [], occupants: [], online: week(() => null), allBusy: "-".repeat(168), allBusyHours: 0, measuredPairHours: 0, coverage: 0 }],
};

it("accepts the measured overlap exactly as the contract describes it", () => {
    expect(parsePlacementOverlap(overlap)).toBe(overlap);
    expect(parsePlacementOverlap({ ...overlap, hosts: [] })).not.toBeNull();
    // Rounded to two decimals, a full hour reads up to 0.01 over and an all-busy one up to 0.01 under its bound.
    const rounded = { ...host, online: week((hour) => hour < 2 ? null : hour % 24 === 20 ? 0.99 : hour === 100 ? 2.01 : 0.25) };
    expect(parsePlacementOverlap({ ...overlap, hosts: [rounded] })).not.toBeNull();
    // A full VPS may still have unknown hours, and a VPS with a free slot has data but no verdict.
    expect(parsePlacementOverlap({ ...overlap, hosts: [{ ...host, slots: 3, allBusy: "-".repeat(168), allBusyHours: 0 }] })).not.toBeNull();
});

it.each([
    ["an extra top-level key", { ...overlap, plan: {} }],
    ["a missing top-level key", without(overlap, "generatedAt")],
    ["hours other than 168", { ...overlap, hours: 167 }],
    ["a window that is not 168 hours", { ...overlap, windowStartedAt: "2026-10-12T01:00:00.000Z" }],
    ["a timestamp without milliseconds", { ...overlap, generatedAt: "2026-10-19T00:07:31Z" }],
    ["hosts that are not a list", { ...overlap, hosts: {} }],
    ["an extra host key", { ...overlap, hosts: [{ ...host, cost: 1 }] }],
    ["a missing host key", { ...overlap, hosts: [without(host, "coverage")] }],
    ["an online series of 167 hours", { ...overlap, hosts: [{ ...host, online: host.online.slice(1) }] }],
    ["a negative online count", { ...overlap, hosts: [{ ...host, online: week((hour) => hour === 5 ? -0.5 : 0) }] }],
    ["a non-finite online count", { ...overlap, hosts: [{ ...host, online: week((hour) => hour === 5 ? Number.POSITIVE_INFINITY : 0) }] }],
    ["an online count given as text", { ...overlap, hosts: [{ ...host, online: week((hour) => hour === 5 ? "1" : 0) }] }],
    ["an all-busy character other than 1, 0 or -", { ...overlap, hosts: [{ ...host, allBusy: `x${host.allBusy.slice(1)}` }] }],
    ["an all-busy string of 167 hours", { ...overlap, hosts: [{ ...host, allBusy: host.allBusy.slice(1) }] }],
    ["an all-busy count that does not match its string", { ...overlap, hosts: [{ ...host, allBusyHours: 6 }] }],
    ["a coverage above 1", { ...overlap, hosts: [{ ...host, coverage: 1.2 }] }],
    ["negative measured pair-hours", { ...overlap, hosts: [{ ...host, measuredPairHours: -1 }] }],
    ["one slot", { ...overlap, hosts: [{ ...host, slots: 1 }] }],
    ["a region key that is not text", { ...overlap, hosts: [{ ...host, regionKeys: [7] }] }],
    ["an extra occupant key", { ...overlap, hosts: [{ ...host, occupants: [{ ...host.occupants[0]!, ownerId: "x" }] }] }],
    ["an occupant with more than 168 hours of data", { ...overlap, hosts: [{ ...host, occupants: [{ ...host.occupants[0]!, hoursWithData: 169 }] }] }],
    ["an occupant with negative hours of data", { ...overlap, hosts: [{ ...host, occupants: [{ ...host.occupants[0]!, hoursWithData: -1 }] }] }],
    // What the control plane's definitions rule out between fields.
    ["more servers than slots", { ...overlap, hosts: [{ ...host, occupants: [...host.occupants, { ...host.occupants[0]!, serverId: "44444444-4444-4444-8444-444444444444" }] }] }],
    ["one server on two VPSs", { ...overlap, hosts: [host, { ...host, serviceName: "vps-other", occupants: [host.occupants[1]!, { ...host.occupants[0]!, serverId: "55555555-5555-4555-8555-555555555555" }] }] }],
    ["more online than servers", { ...overlap, hosts: [{ ...host, online: week((hour) => hour === 100 ? 2.02 : 0.25) }] }],
    ["an all-busy verdict on a VPS with a free slot", { ...overlap, hosts: [{ ...host, slots: 3 }] }],
    ["an all-busy verdict on an empty VPS", { ...overlap, hosts: [{ ...host, occupants: [], online: week(() => null), allBusy: `0${"-".repeat(167)}`, allBusyHours: 0, coverage: 0 }] }],
    ["an all-busy verdict in an hour without data", { ...overlap, hosts: [{ ...host, online: week((hour) => hour === 100 ? null : hour < 2 ? null : hour % 24 === 20 ? 2 : 0.25) }] }],
    ["an all-busy hour with a server under half online", { ...overlap, hosts: [{ ...host, online: week((hour) => hour < 2 ? null : hour % 24 === 20 ? 0.98 : 0.25) }] }],
    ["a window that starts on the half hour", { ...overlap, windowStartedAt: "2026-10-12T00:30:00.000Z", windowEndedAt: "2026-10-19T00:30:00.000Z" }],
    ["a window that ends a second past the hour", { ...overlap, windowStartedAt: "2026-10-12T00:00:01.000Z", windowEndedAt: "2026-10-19T00:00:01.000Z" }],
])("rejects %s", (_case, value) => {
    expect(parsePlacementOverlap(value)).toBeNull();
});

it("splits a window that starts mid-day into its UTC dates", () => {
    const days = overlapDays("2026-10-12T14:00:00.000Z");
    expect(days.map((day) => [day.label, day.hours.length])).toEqual([
        ["Mon 12 Oct", 10], ["Tue 13 Oct", 24], ["Wed 14 Oct", 24], ["Thu 15 Oct", 24], ["Fri 16 Oct", 24], ["Sat 17 Oct", 24], ["Sun 18 Oct", 24], ["Mon 19 Oct", 14],
    ]);
    expect(overlapHourLabel("2026-10-12T14:00:00.000Z", 10)).toBe("Tue 13 Oct 00:00 UTC");
    expect(overlapWindowLabel({ windowStartedAt: "2026-10-12T14:00:00.000Z", windowEndedAt: "2026-10-19T14:00:00.000Z" })).toBe("12 Oct 14:00 – 19 Oct 14:00 UTC");
});

it("shades by online servers over slots, groups by region and explains failed reads", () => {
    expect(overlapBand(2, 2)).toBe(9);
    expect(overlapBand(0, 2)).toBe(0);
    expect(overlapBand(0.6, 2)).toBe(3);
    expect(overlapGroups(overlap.hosts).map((group) => [group.region, group.hosts.map((item) => item.serviceName)])).toEqual([
        ["Germany", ["vps-1a2b3c4d.vps.ovh.net"]], ["No region", ["vps-spare"]],
    ]);
    expect(placementOverlapErrorMessage(new ControlPlaneAdminError("rate_limited", "Too many.", true))).toBe("You can read the measured overlap six times every five minutes. Wait a few minutes, then refresh.");
    expect(placementOverlapErrorMessage(new ControlPlaneAdminError("invalid_request", "Invalid.", false))).toBe("This control plane does not report measured overlap yet.");
    expect(placementOverlapErrorMessage(new ControlPlaneAdminError("placement_history_unavailable", "Host overlap history is unavailable.", true))).toBe("Host overlap history is unavailable.");
    expect(placementOverlapErrorMessage("boom")).toBe("The measured overlap could not be loaded.");
});

it("labels each date segment of the axis as fits its width, keeping the full date in its title", () => {
    expect(overlapDayAxisLabel({ label: "Mon 12 Oct", hours: Array.from({ length: 24 }, (_, hour) => hour) })).toEqual({ text: "Mon 12 Oct", title: "Mon 12 Oct" });
    expect(overlapDayAxisLabel({ label: "Mon 12 Oct", hours: Array.from({ length: 14 }, (_, hour) => hour) }).text).toBe("Mon 12 Oct");
    expect(overlapDayAxisLabel({ label: "Mon 12 Oct", hours: Array.from({ length: 8 }, (_, hour) => hour) }).text).toBe("12 Oct");
    expect(overlapDayAxisLabel({ label: "Mon 12 Oct", hours: [0, 1, 2, 3, 4] }).text).toBe("12");
    expect(overlapDayAxisLabel({ label: "Mon 12 Oct", hours: [0, 1, 2] }).text).toBe("12");
    expect(overlapDayAxisLabel({ label: "Mon 12 Oct", hours: [0, 1] })).toEqual({ text: "", title: "Mon 12 Oct" });
});
