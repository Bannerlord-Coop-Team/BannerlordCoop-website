export type LinkProvider = "discord" | "patreon";
export type LinkRecovery = { accountId: string; provider: LinkProvider; state: "none" | "live" | "expired" | "committed" | "resolved"; operationId?: string; confirmable?: boolean; returnPath?: "/account" | "/servers" };
export function parseLinkRecovery(value: unknown, accountId: string, provider: LinkProvider): LinkRecovery | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    if (v.accountId !== accountId || v.provider !== provider) return null;
    if (v.state === "none") return { accountId, provider, state: "none" };
    if (!["live", "expired", "committed", "resolved"].includes(v.state as string) || typeof v.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v.operationId) || typeof v.confirmable !== "boolean" || !["/account", "/servers"].includes(v.returnPath as string)) return null;
    return { accountId, provider, state: v.state as LinkRecovery["state"], operationId: v.operationId, confirmable: v.confirmable, returnPath: v.returnPath as "/account" | "/servers" };
}
