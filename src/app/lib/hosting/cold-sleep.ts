/** Cold sleep keeps the running intent while the game is suspended. */
export function isColdSleeping(operationState: string, desiredState: string | undefined) {
    return operationState === "suspended" && desiredState === "running";
}

export const COLD_SLEEP_LABEL = "Sleeping — wakes when a player connects";
