/** Enough to step back through a play session without keeping an unbounded log in the browser. */
export const CONSOLE_HISTORY_LIMIT = 50;

/** Where the composer is in its history: null while editing a fresh draft, kept aside as `stash`. */
export type ConsoleHistoryCursor = { index: number | null; stash: string };

export const IDLE_HISTORY_CURSOR: ConsoleHistoryCursor = { index: null, stash: "" };

/** Adds a sent command as the newest entry, skipping an immediate repeat and dropping the oldest past the limit. */
export function appendConsoleHistory(history: readonly string[], command: string): string[] {
    if (!command || history[history.length - 1] === command) return [...history];
    return [...history, command].slice(-CONSOLE_HISTORY_LIMIT);
}

/**
 * Moves through history like a terminal: Up recalls older commands and keeps the unsent draft aside,
 * Down walks back toward the newest and then restores that draft. Returns null when the key should
 * keep its normal behaviour.
 */
export function stepConsoleHistory(history: readonly string[], cursor: ConsoleHistoryCursor, draft: string, direction: "older" | "newer"):
    { cursor: ConsoleHistoryCursor; draft: string } | null {
    if (history.length === 0) return null;
    if (direction === "older") {
        const index = cursor.index === null ? history.length - 1 : Math.max(0, cursor.index - 1);
        return { cursor: { index, stash: cursor.index === null ? draft : cursor.stash }, draft: history[index] };
    }
    if (cursor.index === null) return null;
    if (cursor.index + 1 >= history.length) return { cursor: IDLE_HISTORY_CURSOR, draft: cursor.stash };
    return { cursor: { ...cursor, index: cursor.index + 1 }, draft: history[cursor.index + 1] };
}

/** Per account and server, so one owner's commands never appear on another server or account. */
export function consoleHistoryKey(userId: string, serverId: string) {
    return `blcoop-console-history:${userId}:${serverId}`;
}

/** Reads stored history, treating missing, blocked or malformed storage as empty. */
export function readConsoleHistory(storage: Pick<Storage, "getItem"> | undefined, key: string): string[] {
    try {
        const value: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
        if (!Array.isArray(value)) return [];
        return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0).slice(-CONSOLE_HISTORY_LIMIT);
    } catch {
        return [];
    }
}

/** Stores history best-effort; private browsing or a full quota just keeps it for this page. */
export function writeConsoleHistory(storage: Pick<Storage, "setItem"> | undefined, key: string, history: readonly string[]) {
    try {
        storage?.setItem(key, JSON.stringify(history.slice(-CONSOLE_HISTORY_LIMIT)));
    } catch {
        // Storage can be unavailable or full; history then lasts for this page only.
    }
}
