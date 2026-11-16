/** Limitless Coop Compat v1.1.0 BattleSizePostfix maximum; CP remains authoritative at execution. */
export function maximumBattleSize(modules: readonly { id: string; enabled: boolean; runsOn?: "server" | "players" }[]): 1000 | 12000 {
    return modules.some(mod => mod.id.toLowerCase() === "limitless" && mod.enabled)
        && modules.some(mod => mod.id.toLowerCase() === "limitless.coopcompat" && mod.enabled && mod.runsOn !== "players") ? 12000 : 1000;
}
