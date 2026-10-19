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

/**
 * Whether a completion notice announces this finished move. The control plane writes it as the move settles,
 * after the job completes, with the same address; earlier moves' notices stay for 14 days and are not it.
 */
export function isCurrentMoveCompletion(notice: Pick<MyServerNotice, "kind" | "createdAt" | "parameters">, move: MyServerMove | null) {
    if (notice.kind !== "placement-completed" || move?.state !== "moved" || move.completedAt === null) return false;
    const address = notice.parameters.address;
    return Date.parse(notice.createdAt) >= Date.parse(move.completedAt)
        && (typeof address !== "string" || move.address === null || address === move.address);
}

/** Placement notices the move card already says: the announcement until the move ends, and this move's completion. */
export function moveCoversNotice(notice: Pick<MyServerNotice, "kind" | "createdAt" | "parameters">, move: MyServerMove | null) {
    if (notice.kind === "placement-scheduled") return move !== null && move.state !== "moved" && move.state !== "failed";
    return isCurrentMoveCompletion(notice, move);
}
