import { createContext, useContext } from "react";
import type { MyServerMove, MyServerNotice } from "@/app/lib/control-plane/types";

/**
 * The move a managed server page follows, set by ManagedServerMoveProvider. It lives apart from the provider
 * so panels that only read it, such as the console, do not import the provider's server action.
 */
export const ManagedServerMoveContext = createContext<{ serverId: string; move: MyServerMove | null } | null>(null);

/** The move status this page follows, or null without a move or outside a managed server page. */
export function useManagedServerMove() {
    return useContext(ManagedServerMoveContext)?.move ?? null;
}

/** Placement notices the move card already says: the announcement until the move ends, and the completion once moved. */
export function moveCoversNotice(notice: Pick<MyServerNotice, "kind">, move: MyServerMove | null) {
    if (move === null) return false;
    if (notice.kind === "placement-scheduled") return move.state !== "moved" && move.state !== "failed";
    return notice.kind === "placement-completed" && move.state === "moved";
}
