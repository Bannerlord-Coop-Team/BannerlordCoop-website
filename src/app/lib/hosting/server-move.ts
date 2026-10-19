import type { MyServerMove } from "@/app/lib/control-plane/types";

/** Every state the owner `server-move-status` read reports. */
export const SERVER_MOVE_STATES: readonly MyServerMove["state"][] = ["scheduled", "starting", "moving", "returning", "moved", "failed"];

/** A move's steps in the order the relocation job runs them. */
export const SERVER_MOVE_STEPS: readonly NonNullable<MyServerMove["step"]>[] = [
    "preparing", "saving-and-stopping", "backing-up", "restoring", "switching-address", "starting-game", "finishing",
];

export type ServerMoveInProgress = MyServerMove & { state: "moving" | "returning" };

/** A move that has taken the server over: Start, Stop and Restart wait until it finishes. */
export function isMoveInProgress(move: MyServerMove | null | undefined): move is ServerMoveInProgress {
    return move?.state === "moving" || move?.state === "returning";
}
