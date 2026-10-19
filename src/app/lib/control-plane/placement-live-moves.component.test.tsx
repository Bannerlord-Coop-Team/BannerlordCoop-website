import { expect, it } from "vitest";
import {
    activePlacementRelocation,
    orderPlacementRelocations,
    placementMovesStartedLabel,
    placementRelocationDuration,
    placementRelocationErrorLabel,
    placementRelocationProgress,
    placementRelocationTrack,
    shortServiceName,
    type PlacementTrackStep,
} from "./placement-live-moves";
import type { HostingPlacementRelocation, HostingPlacementRelocationProgress } from "./types";

function relocation(relocationId: string, state: HostingPlacementRelocation["state"], extra: Partial<HostingPlacementRelocation> = {}): HostingPlacementRelocation {
    return {
        relocationId, serverId: `${relocationId}-server`, displayName: relocationId, fromServiceName: "vps-1a2b3c4d.vps.ovh.net", toServiceName: "vps-5e6f7a8b.vps.ovh.net",
        targetRegion: "germany", mode: "announced", state, gainPairHoursPerWeek: 31.4, scheduledAt: "2026-10-19T14:51:59.999Z", announcementNoticeId: null,
        completionNoticeId: null, jobId: null, errorCode: null, createdAt: "2026-10-19T13:51:59.999Z", queuedAt: null, updatedAt: "2026-10-19T13:51:59.999Z", completedAt: null, ...extra,
    };
}

const noJob: HostingPlacementRelocationProgress = { step: null, steps: [], jobState: null, jobStartedAt: null, jobCompletedAt: null, restartsGame: null, warnings: [] };
const restoring: HostingPlacementRelocationProgress = {
    step: "restoring",
    steps: [
        { step: "preparing", reachedAt: "2026-10-19T14:52:10.020Z" },
        { step: "saving-and-stopping", reachedAt: "2026-10-19T14:52:14.611Z" },
        { step: "backing-up", reachedAt: "2026-10-19T14:53:20.104Z" },
        { step: "restoring", reachedAt: "2026-10-19T14:54:02.937Z" },
    ],
    jobState: "running", jobStartedAt: "2026-10-19T14:52:11.302Z", jobCompletedAt: null, restartsGame: true,
    warnings: [{ minutes: 60, state: "succeeded", sentAt: "2026-10-19T13:52:03.415Z" }, { minutes: 10, state: "succeeded", sentAt: "2026-10-19T14:42:04.877Z" }],
};
// A stopped server's finished move never reaches the game start.
const offlineDone: HostingPlacementRelocationProgress = {
    step: null,
    steps: (["preparing", "saving-and-stopping", "backing-up", "restoring", "switching-address", "finishing"] as const)
        .map((step, index) => ({ step, reachedAt: new Date(Date.parse("2026-10-19T10:00:01.000Z") + index * 40_000).toISOString() })),
    jobState: "succeeded", jobStartedAt: "2026-10-19T10:00:00.000Z", jobCompletedAt: "2026-10-19T10:04:12.000Z", restartsGame: false, warnings: [],
};

const summary = (steps: PlacementTrackStep[]) => steps.map((step) => `${step.label}:${step.phase}`);

it("tracks a running move to its current step with the time it reached each", () => {
    const steps = placementRelocationTrack(relocation("live", "queued", { jobId: "job" }), restoring);
    expect(summary(steps)).toEqual([
        "Warned:done", "Starting:done", "Saving & stopping:done", "Restore point:done", "Restoring:current",
        "Switching address:waiting", "Starting game:waiting", "Finishing:waiting", "Done:waiting",
    ]);
    expect(steps.filter((step) => step.phase === "current")).toHaveLength(1);
    expect(steps[1]!.reachedAt).toBe("2026-10-19T14:52:10.020Z");
    expect(steps[4]!.reachedAt).toBe("2026-10-19T14:54:02.937Z");
    expect(steps[5]!.reachedAt).toBeNull();
    expect(steps[0]!.warnings).toEqual([
        { minutes: 60, label: "sent", sentAt: "2026-10-19T13:52:03.415Z" },
        { minutes: 10, label: "sent", sentAt: "2026-10-19T14:42:04.877Z" },
    ]);
});

it("never says a move starts a stopped server's game", () => {
    const steps = placementRelocationTrack(relocation("offline", "succeeded", { mode: "offline", completedAt: "2026-10-19T10:04:13.000Z" }), offlineDone);
    expect(summary(steps)).toEqual([
        "Warned:not-needed", "Starting:done", "Saving & stopping:done", "Restore point:done", "Restoring:done",
        "Switching address:done", "Stays stopped:not-needed", "Finishing:done", "Done:done",
    ]);
    expect(steps[0]!.note).toBe("No warning needed: the server was stopped");
    expect(steps[0]!.warnings).toEqual([]);
    expect(steps[6]).toMatchObject({ reachedAt: null, note: "The game was stopped, so the move leaves it stopped" });
    expect(steps.some((step) => step.label === "Starting game")).toBe(false);
    expect(steps[8]!.reachedAt).toBe("2026-10-19T10:04:13.000Z");
    expect(placementRelocationDuration(offlineDone)).toBe("4 min 12 s");
});

it("shows an announced move's warnings and starts a game only if it is running", () => {
    const steps = placementRelocationTrack(relocation("soon", "announced"), {
        ...noJob, warnings: [{ minutes: 60, state: "succeeded", sentAt: "2026-10-19T13:52:03.415Z" }, { minutes: 10, state: "queued", sentAt: null }],
    });
    expect(steps[0]).toMatchObject({ phase: "current", warnings: [
        { minutes: 60, label: "sent", sentAt: "2026-10-19T13:52:03.415Z" }, { minutes: 10, label: "pending", sentAt: null },
    ] });
    expect(steps.slice(1).every((step) => step.phase === "waiting")).toBe(true);
    expect(steps[6]).toMatchObject({ label: "Starting game", note: "Only if the game is running when the move begins" });
    // A warning not yet due is pending while announced, and was never sent once the move went ahead.
    expect(placementRelocationTrack(relocation("soon", "announced"), noJob)[0]!.warnings.map((warning) => warning.label)).toEqual(["pending", "pending"]);
    expect(placementRelocationTrack(relocation("gone", "cancelled"), {
        ...noJob, warnings: [{ minutes: 60, state: "unsupported", sentAt: null }, { minutes: 10, state: "failed", sentAt: null }],
    })[0]!.warnings.map((warning) => warning.label)).toEqual(["not possible on this runner", "not sent"]);
});

it("ends a failed or cancelled move's track with its outcome and marks no current step", () => {
    const failed = placementRelocationTrack(relocation("broke", "failed", { completedAt: "2026-10-19T15:10:00.000Z" }), { ...restoring, step: null, jobState: "failed" });
    expect(failed.at(-1)).toMatchObject({ label: "Failed", phase: "failed", reachedAt: "2026-10-19T15:10:00.000Z" });
    expect(failed.some((step) => step.phase === "current")).toBe(false);
    // A finished move does not claim a current step even if its job still names one.
    expect(placementRelocationTrack(relocation("stop", "cancelled"), restoring).some((step) => step.phase === "current")).toBe(false);
    expect(placementRelocationTrack(relocation("stop", "cancelled"), restoring).at(-1)).toMatchObject({ label: "Cancelled", phase: "cancelled" });
    expect(placementRelocationErrorLabel("placement_window_missed")).toBe("Cancelled because the move could not start within its announced window.");
    expect(placementRelocationErrorLabel("placement_disabled")).toBe("Cancelled because automatic placement was switched off.");
    expect(placementRelocationErrorLabel("relocation_cutover_failed")).toBeNull();
});

it("reads progress only when the control plane sent a usable one", () => {
    expect(placementRelocationProgress(relocation("old", "succeeded"))).toBeNull();
    expect(placementRelocationProgress(relocation("odd", "succeeded", { progress: { ...noJob, steps: undefined } as unknown as HostingPlacementRelocationProgress }))).toBeNull();
    expect(placementRelocationProgress(relocation("new", "queued", { progress: restoring }))).toBe(restoring);
});

it("orders moves under way first and writes names, durations and counts", () => {
    const list = [relocation("a", "succeeded"), relocation("b", "queued"), relocation("c", "failed"), relocation("d", "announced")];
    expect(orderPlacementRelocations(list).map((item) => item.relocationId)).toEqual(["b", "d", "a", "c"]);
    expect(shortServiceName("vps-1a2b3c4d.vps.ovh.net")).toBe("vps-1a2b3c4d");
    expect(shortServiceName("vps-7e1cbd42")).toBe("vps-7e1cbd42");
    expect(placementRelocationDuration({ jobStartedAt: "2026-10-19T10:00:00.000Z", jobCompletedAt: "2026-10-19T10:00:45.000Z" })).toBe("45 s");
    expect(placementRelocationDuration({ jobStartedAt: "2026-10-19T10:00:00.000Z", jobCompletedAt: "2026-10-19T11:03:30.000Z" })).toBe("1 h 3 min");
    expect(placementRelocationDuration({ jobStartedAt: "2026-10-19T10:00:00.000Z", jobCompletedAt: null })).toBeNull();
    expect(placementRelocationDuration({ jobStartedAt: "2026-10-19T10:00:00.000Z", jobCompletedAt: "2026-10-19T09:00:00.000Z" })).toBeNull();
    expect(placementMovesStartedLabel(1)).toBe("1 move started in the last 24 hours");
    expect(placementMovesStartedLabel(3)).toBe("3 moves started in the last 24 hours");
    expect(activePlacementRelocation({ status: { activeRelocationId: "b", queuedInLast24Hours: 1 }, relocations: list })?.relocationId).toBe("b");
    expect(activePlacementRelocation({ status: { activeRelocationId: null, queuedInLast24Hours: 1 }, relocations: list })).toBeNull();
    expect(activePlacementRelocation({ relocations: list })).toBeNull();
});
