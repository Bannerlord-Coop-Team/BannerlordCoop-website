export type ServerVisibility = "private" | "public";
export type PublicServerSummary = {
    serverId: string;
    displayName: string;
    friendlyRegion: string | null;
    observedGameState: string | null;
    connectionIp: string | null;
    gamePorts: number[];
};
export type PublicServerPage = { items: PublicServerSummary[]; nextCursor: string | null };
export type VisibilityMutation = {
    action: "set-server-visibility";
    serverId: string;
    visibility: ServerVisibility;
    expectedUpdatedAt: string;
};
export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown, max: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
}
export function isGameIp(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 64) return false;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value)) {
        return value.split(".").every(part => Number(part) <= 255 && String(Number(part)) === part);
    }
    if (!value.includes(":") || !/^[a-f\d:.]+$/iu.test(value)) return false;
    try { return new URL(`http://[${value}]/`).hostname.startsWith("["); } catch { return false; }
}
export function isGamePorts(value: unknown): value is number[] {
    return Array.isArray(value) && value.length <= 32
        && value.every(port => Number.isInteger(port) && port >= 1 && port <= 65_535);
}
export function parsePublicServerPage(value: unknown): PublicServerPage {
    if (!isRecord(value) || !exactKeys(value, ["items", "nextCursor"]) || !Array.isArray(value.items)
        || value.items.length > 100 || (value.nextCursor !== null && !text(value.nextCursor, 2_048))) {
        throw new Error("Invalid public server page");
    }
    const ids = new Set<string>();
    const items = value.items.map(item => {
        if (!isRecord(item) || !exactKeys(item, ["serverId", "displayName", "friendlyRegion", "observedGameState", "connectionIp", "gamePorts"])
            || typeof item.serverId !== "string" || !SERVER_ID.test(item.serverId)
            || !text(item.displayName, 200) || (item.friendlyRegion !== null && !text(item.friendlyRegion, 128))
            || (item.observedGameState !== null && !text(item.observedGameState, 64))
            || (item.connectionIp !== null && !isGameIp(item.connectionIp)) || !isGamePorts(item.gamePorts)
            || ids.has(item.serverId)) throw new Error("Invalid public server summary");
        ids.add(item.serverId);
        return item as PublicServerSummary;
    });
    return { items, nextCursor: value.nextCursor as string | null };
}
function timestamp(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function parseVisibilityMutation(value: unknown): VisibilityMutation {
    if (!isRecord(value) || !exactKeys(value, ["action", "serverId", "visibility", "expectedUpdatedAt"])
        || value.action !== "set-server-visibility" || typeof value.serverId !== "string" || !SERVER_ID.test(value.serverId)
        || !["public", "private"].includes(String(value.visibility)) || !timestamp(value.expectedUpdatedAt)) {
        throw new Error("Invalid visibility update");
    }
    return value as VisibilityMutation;
}
export function parseVisibilityResult(value: unknown, input: VisibilityMutation): { serverId: string; visibility: ServerVisibility; updatedAt: string } {
    if (!isRecord(value) || !exactKeys(value, ["serverId", "visibility", "updatedAt"])
        || value.serverId !== input.serverId || value.visibility !== input.visibility || !timestamp(value.updatedAt)) {
        throw new Error("Invalid visibility result");
    }
    return value as { serverId: string; visibility: ServerVisibility; updatedAt: string };
}
export async function readPublicResponse(response: Response): Promise<unknown> {
    if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) throw new Error("Invalid response type");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let result = "";
    let bytes = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 256 * 1_024) throw new Error("Response too large");
            result += decoder.decode(value, { stream: true });
        }
        result += decoder.decode();
        return JSON.parse(result);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
