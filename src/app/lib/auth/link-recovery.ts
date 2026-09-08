export type LinkProvider = "discord" | "patreon";
export type LinkRecovery = { accountId: string; provider: LinkProvider; state: "none" | "live" | "expired" | "committed" | "resolved" | "historical" | "retired"; operationId?: string; confirmable?: boolean; returnPath?: "/account" | "/servers" };
type LinkResolution = Omit<LinkRecovery, "state"> & { state: "cancelled" | "committed" | "retired" };
function parse(value: unknown, accountId: string, provider: LinkProvider, resolution: boolean): LinkRecovery | LinkResolution | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    if (v.accountId !== accountId || v.provider !== provider) return null;
    if (!resolution && v.state === "none") return { accountId, provider, state: "none" };
    const states = resolution ? ["cancelled", "committed", "retired"] : ["live", "expired", "committed", "resolved", "historical", "retired"];
    if (!states.includes(v.state as string) || typeof v.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v.operationId) || typeof v.confirmable !== "boolean" || !["/account", "/servers"].includes(v.returnPath as string)) return null;
    if (["historical", "retired"].includes(v.state as string) && (provider !== "discord" || v.confirmable || v.receipt != null)) return null;
    return { accountId, provider, state: v.state as LinkRecovery["state"] | LinkResolution["state"], operationId: v.operationId, confirmable: v.confirmable, returnPath: v.returnPath as "/account" | "/servers" };
}
export function parseLinkRecovery(value: unknown, accountId: string, provider: LinkProvider): LinkRecovery | null {
    return parse(value, accountId, provider, false) as LinkRecovery | null;
}
export function parseLinkResolution(value: unknown, accountId: string, provider: LinkProvider, operationId: string): LinkResolution | null {
    const result = parse(value, accountId, provider, true) as LinkResolution | null;
    return result?.operationId === operationId ? result : null;
}
