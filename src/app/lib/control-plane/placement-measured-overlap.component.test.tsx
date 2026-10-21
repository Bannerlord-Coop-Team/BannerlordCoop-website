import { expect, it } from "vitest";
import { ControlPlaneAdminError } from "./client";
import {
    overlapAtOnceLabel,
    overlapBand,
    overlapBurstLabel,
    overlapBurstRow,
    overlapCellLabel,
    overlapDayAxisLabel,
    overlapDays,
    overlapGroups,
    overlapHourLabel,
    overlapOverRow,
    overlapReportsAtOnce,
    overlapSummary,
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
const GIB = 1024 ** 3;

// The legacy shape, from a control plane that predates burst capacity (98d1f12a).
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

// The burst-capacity shape: four servers on a 6 vCPU, 12 GiB VPS, where three can each burst to 1.6 vCPU and 2.5 GiB at
// once, so the hours all four were online at least half the hour are over.
const burstHost = {
    serviceName: "vps-1a2b3c4d.vps.ovh.net", regionKeys: ["germany"], vCpu: 6, memoryBytes: 12 * GIB, slots: 4, burstServers: 3,
    occupants: [
        ...host.occupants,
        { serverId: "55555555-5555-4555-8555-555555555555", displayName: "Vlandia Rising", hoursWithData: 150 },
        { serverId: "66666666-6666-4666-8666-666666666666", displayName: "Aserai Sands", hoursWithData: 140 },
    ],
    online: week((hour) => hour < 2 ? null : hour % 24 === 20 ? 4 : 0.25),
    overBurst: week((hour) => hour < 48 ? "-" : hour % 24 === 20 ? "1" : "0").join(""),
    overBurstHours: 5, measuredPairHours: 7.5, coverage: 0.714,
};
// An empty VPS whose RAM could not be read: two can burst at once by its vCPUs, and it can never be over.
const burstSpare = {
    serviceName: "vps-spare", regionKeys: [], vCpu: 4, memoryBytes: null, slots: 2, burstServers: 2, occupants: [],
    online: week(() => null), overBurst: "0".repeat(168), overBurstHours: 0, measuredPairHours: 0, coverage: 0,
};
const burstOverlap = { ...overlap, hosts: [burstHost, burstSpare] };
/** The over-burst hour on Wed 14 Oct 20:00 UTC, and a measured hour within capacity. */
const OVER_HOUR = 2 * 24 + 20;
const MEASURED_HOUR = 100;

it("accepts burst servers counted at 3 GiB each, as the current control plane does, and at 2.5 GiB, as the next one does", () => {
    // 6 vCPUs let three burst; 5 GiB holds one server's 3 GiB, or two at 2.5 GiB.
    const at = (burstServers: number) => ({ ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: 5 * GIB, burstServers }] });
    expect(parsePlacementOverlap(at(1))).not.toBeNull();
    expect(parsePlacementOverlap(at(2))).not.toBeNull();
    expect(parsePlacementOverlap(at(3))).toBeNull();
});

it("accepts the burst-capacity shape exactly as the contract describes it", () => {
    expect(parsePlacementOverlap(burstOverlap)).toBe(burstOverlap);
    expect(parsePlacementOverlap({ ...burstOverlap, hosts: [burstSpare] })).not.toBeNull();
    // Rounded to two decimals, an over-burst hour reads up to 0.01 under its bound and a full hour up to 0.01 over.
    const rounded = { ...burstHost, online: burstHost.online.map((online, hour) => hour === OVER_HOUR ? 1.99 : hour === MEASURED_HOUR ? 4.01 : online) };
    expect(parsePlacementOverlap({ ...burstOverlap, hosts: [rounded] })).not.toBeNull();
    // burstServers at both its vCPU and its RAM bound at once, the RAM a whole multiple of 2.5 GiB, and memoryBytes at its largest.
    expect(parsePlacementOverlap({ ...burstOverlap, hosts: [{ ...burstHost, vCpu: 5, memoryBytes: 7.5 * GIB }] })).not.toBeNull();
    expect(parsePlacementOverlap({ ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: Number.MAX_SAFE_INTEGER }] })).not.toBeNull();
    // No server can burst on one vCPU or the smallest RAM, so any measured hour with one online at least half of it is over.
    expect(parsePlacementOverlap({ ...burstOverlap, hosts: [{ ...burstHost, vCpu: 1, burstServers: 0 }] })).not.toBeNull();
    expect(parsePlacementOverlap({ ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: 1, burstServers: 0 }] })).not.toBeNull();
    // A VPS with as many servers as can burst together is all 0, even in hours without data.
    expect(parsePlacementOverlap({ ...burstOverlap, hosts: [{ ...burstHost, vCpu: 8, burstServers: 4, overBurst: "0".repeat(168), overBurstHours: 0 }] })).not.toBeNull();
});

it("accepts the legacy shape exactly as the contract describes it", () => {
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

it.each([
    // The read is all one shape or the other.
    ["a burst-capacity host beside a legacy one", { ...burstOverlap, hosts: [burstHost, overlap.hosts[1]] }],
    ["a legacy host beside a burst-capacity one", { ...overlap, hosts: [host, burstSpare] }],
    ["a host with both shapes' keys", { ...burstOverlap, hosts: [{ ...burstHost, allBusy: "-".repeat(168), allBusyHours: 0 }] }],
    ["a host without memoryBytes", { ...burstOverlap, hosts: [without(burstHost, "memoryBytes")] }],
    ["a host without overBurstHours", { ...burstOverlap, hosts: [without(burstHost, "overBurstHours")] }],
    ["memoryBytes of 0", { ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: 0 }] }],
    ["negative memoryBytes", { ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: -GIB }] }],
    ["fractional memoryBytes", { ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: 12 * GIB + 0.5 }] }],
    ["memoryBytes given as text", { ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: String(12 * GIB) }] }],
    ["memoryBytes beyond the safe integers", { ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: 2 ** 53 }] }],
    ["a negative burstServers", { ...burstOverlap, hosts: [{ ...burstHost, burstServers: -1 }] }],
    ["a fractional burstServers", { ...burstOverlap, hosts: [{ ...burstHost, burstServers: 2.5 }] }],
    ["more burstServers than its vCPUs allow", { ...burstOverlap, hosts: [{ ...burstHost, vCpu: 4 }] }],
    ["more burstServers than its RAM allows", { ...burstOverlap, hosts: [{ ...burstHost, memoryBytes: 7.5 * GIB - 1 }] }],
    ["more burstServers than its vCPUs allow when its RAM is unknown", { ...burstOverlap, hosts: [{ ...burstHost, vCpu: 4, memoryBytes: null }] }],
    ["an over-burst character other than 1, 0 or -", { ...burstOverlap, hosts: [{ ...burstHost, overBurst: `x${burstHost.overBurst.slice(1)}` }] }],
    ["an over-burst string of 167 hours", { ...burstOverlap, hosts: [{ ...burstHost, overBurst: burstHost.overBurst.slice(1) }] }],
    ["an over-burst count that does not match its string", { ...burstOverlap, hosts: [{ ...burstHost, overBurstHours: 6 }] }],
    // What the burst definitions rule out between fields.
    ["an over-burst hour on a VPS whose servers can all burst at once", { ...burstOverlap, hosts: [{ ...burstHost, vCpu: 8, burstServers: 4 }] }],
    ["an unknown hour on a VPS whose servers can all burst at once", { ...burstOverlap, hosts: [{ ...burstSpare, overBurst: `-${"0".repeat(167)}` }] }],
    ["an over-burst hour without data", { ...burstOverlap, hosts: [{ ...burstHost, online: burstHost.online.map((online, hour) => hour === OVER_HOUR ? null : online) }] }],
    ["an over-burst hour with too few online", { ...burstOverlap, hosts: [{ ...burstHost, online: burstHost.online.map((online, hour) => hour === OVER_HOUR ? 1.98 : online) }] }],
    ["a measured hour without data on a VPS that can be over", { ...burstOverlap, hosts: [{ ...burstHost, online: burstHost.online.map((online, hour) => hour === MEASURED_HOUR ? null : online) }] }],
    ["more servers than slots", { ...burstOverlap, hosts: [{ ...burstHost, slots: 3 }] }],
    ["more online than servers", { ...burstOverlap, hosts: [{ ...burstHost, online: burstHost.online.map((online, hour) => hour === MEASURED_HOUR ? 4.02 : online) }] }],
    ["one server on two VPSs", { ...burstOverlap, hosts: [burstHost, { ...burstSpare, burstServers: 1, occupants: [burstHost.occupants[3]!], online: week(() => 0.5) }] }],
])("rejects a burst-capacity read with %s", (_case, value) => {
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

// A control plane that fits on typical demand (#550): the burst fields kept as information, and its at-once capacity.
// The same four servers on the 6 vCPU VPS can all run at once at what they usually need, so no hour is over at once,
// though three can burst together and four online at 20:00 are still over burst capacity.
const atOnceHost = { ...burstHost, atOnceServers: 4, overAtOnce: "0".repeat(168), overAtOnceHours: 0 };
// Run at most three at once, the hours all four were online at least half the hour are over, as over burst.
const tightHost = { ...burstHost, atOnceServers: 3, overAtOnce: burstHost.overBurst, overAtOnceHours: 5 };
// A VPS whose at-once capacity is unknown: every hour is unknown.
const unknownHost = { ...burstSpare, atOnceServers: null, overAtOnce: "-".repeat(168), overAtOnceHours: 0 };
const atOnceOverlap = { ...overlap, hosts: [atOnceHost, unknownHost] };

it("accepts the at-once shape exactly as the contract describes it, with its red hours from at-once capacity", () => {
    expect(parsePlacementOverlap(atOnceOverlap)).toBe(atOnceOverlap);
    expect(parsePlacementOverlap({ ...overlap, hosts: [tightHost] })).not.toBeNull();
    expect(overlapReportsAtOnce(atOnceOverlap)).toBe(true);
    expect(overlapReportsAtOnce(burstOverlap)).toBe(false);
    // Over burst capacity but able to run all four at once: no red row, and burst stays as information.
    expect(overlapOverRow(atOnceHost)).toBeNull();
    expect(overlapBurstRow(atOnceHost)).toBe(burstHost.overBurst);
    expect(overlapAtOnceLabel(atOnceHost)).toBe("Fits at once");
    expect(overlapBurstLabel(atOnceHost)).toBe("Burst headroom: 3 could burst at once");
    expect(overlapBurstLabel(burstHost)).toBe("5 h over burst");
    expect(overlapCellLabel(atOnceHost, overlap.windowStartedAt, OVER_HOUR)).toBe("Wed 14 Oct 20:00 UTC · 4 online; can run 4 at once; 3 can burst together, over burst capacity");
    // Three at once: the over-burst hours are now over at-once capacity.
    expect(overlapOverRow(tightHost)).toBe(burstHost.overBurst);
    expect(overlapAtOnceLabel(tightHost)).toBe("5 h over at once");
    expect(overlapCellLabel(tightHost, overlap.windowStartedAt, OVER_HOUR)).toBe("Wed 14 Oct 20:00 UTC · 4 online; can run 3 at once; over at-once capacity; 3 can burst together, over burst capacity");
    expect(overlapCellLabel(tightHost, overlap.windowStartedAt, 10)).toBe("Mon 12 Oct 10:00 UTC · 0.25 online; can run 3 at once; over at once unknown (a server has no data); 3 can burst together");
    expect(overlapSummary(tightHost, overlap.windowStartedAt)).toBe("vps-1a2b3c4d: 4 of 4 slots; can run 3 at once; over at once 5 hours in the week; 3 can burst together; over burst 5 hours in the week; busiest Mon 12 Oct 20:00 UTC, 4 online; 71% measured");
    // Unknown at-once capacity: no red row.
    expect(overlapOverRow(unknownHost)).toBeNull();
    expect(overlapAtOnceLabel(unknownHost)).toBe("At once not modelled yet");
    // The burst shape keeps its red row from burst capacity.
    expect(overlapOverRow(burstHost)).toBe(burstHost.overBurst);
    expect(overlapAtOnceLabel(burstHost)).toBeNull();
});

it.each([
    ["one VPS of each shape", { ...overlap, hosts: [atOnceHost, burstSpare] }],
    ["an at-once VPS with an extra key", { ...overlap, hosts: [{ ...atOnceHost, atOnceVerdict: "fits" }] }],
    ["an at-once VPS without its hours", { ...overlap, hosts: [without(atOnceHost, "overAtOnceHours")] }],
    ["at-once hours over when all can run at once", { ...overlap, hosts: [{ ...atOnceHost, overAtOnce: burstHost.overBurst, overAtOnceHours: 5 }] }],
    ["an over-at-once count that is not of its hours", { ...overlap, hosts: [{ ...tightHost, overAtOnceHours: 4 }] }],
    ["known hours while at-once capacity is unknown", { ...overlap, hosts: [{ ...unknownHost, overAtOnce: "0".repeat(168) }] }],
    ["a fractional at-once capacity", { ...overlap, hosts: [{ ...atOnceHost, atOnceServers: 3.5 }] }],
    ["a negative at-once capacity", { ...overlap, hosts: [{ ...atOnceHost, atOnceServers: -1 }] }],
])("rejects %s, in the at-once shape", (_case, value) => {
    expect(parsePlacementOverlap(value)).toBeNull();
});
