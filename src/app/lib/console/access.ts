import type { User } from "@supabase/supabase-js";

export const LIVE_CONSOLE_OWNER_IDS_KEY = "live_console_owner_server_ids";
export const LIVE_CONSOLE_OPERATOR_IDS_KEY = "live_console_operator_server_ids";

export type LiveConsoleAccessLevel = "admin" | "owner" | "operator";
export type LiveConsoleMember = {
    id: string;
    displayName: string;
    email: string;
};

function serverIds(
    metadata: Record<string, unknown> | null | undefined,
    key: string,
) {
    const value = metadata?.[key];
    if (!Array.isArray(value)) return [];

    return [...new Set(value.filter(
        (serverId): serverId is string =>
            typeof serverId === "string" && serverId.length > 0 && serverId.length <= 128,
    ))];
}

export function getOwnedLiveConsoleServerIds(
    metadata: Record<string, unknown> | null | undefined,
) {
    return serverIds(metadata, LIVE_CONSOLE_OWNER_IDS_KEY);
}

export function getOperatedLiveConsoleServerIds(
    metadata: Record<string, unknown> | null | undefined,
) {
    return serverIds(metadata, LIVE_CONSOLE_OPERATOR_IDS_KEY);
}

export function getAssignedLiveConsoleAccess(
    metadata: Record<string, unknown> | null | undefined,
    serverId: string,
): Exclude<LiveConsoleAccessLevel, "admin"> | null {
    if (getOwnedLiveConsoleServerIds(metadata).includes(serverId)) return "owner";
    if (getOperatedLiveConsoleServerIds(metadata).includes(serverId)) return "operator";
    return null;
}

export function withLiveConsoleServerAssignment(
    metadata: Record<string, unknown> | null | undefined,
    key: typeof LIVE_CONSOLE_OWNER_IDS_KEY | typeof LIVE_CONSOLE_OPERATOR_IDS_KEY,
    serverId: string,
    assigned: boolean,
) {
    const ids = serverIds(metadata, key).filter((id) => id !== serverId);
    if (assigned) ids.push(serverId);

    return {
        ...(metadata ?? {}),
        [key]: ids,
    };
}

export function getLiveConsoleMember(user: User): LiveConsoleMember {
    const metadata = user.user_metadata ?? {};
    const displayName =
        metadata.full_name ??
        metadata.name ??
        metadata.user_name ??
        user.email?.split("@")[0] ??
        "Unnamed member";

    return {
        id: user.id,
        displayName: String(displayName),
        email: user.email ?? "No email",
    };
}
