export const LIVE_CONSOLE_OWNER_IDS_KEY = "live_console_owner_server_ids";
export const LIVE_CONSOLE_OPERATOR_IDS_KEY = "live_console_operator_server_ids";

function hasServerAssignment(metadata, key, serverId) {
    const assignments = metadata?.[key];
    return Array.isArray(assignments) && assignments.includes(serverId);
}

export function getConsoleServerAccess(user, serverId, bootstrapAdminEmails = new Set()) {
    if (!user || typeof serverId !== "string") return null;

    const bootstrapAdmin = Boolean(
        user.email && bootstrapAdminEmails.has(user.email.toLowerCase()),
    );
    if (user.app_metadata?.role === "Admin" || bootstrapAdmin) return "admin";
    if (hasServerAssignment(user.app_metadata, LIVE_CONSOLE_OWNER_IDS_KEY, serverId)) {
        return "owner";
    }
    if (hasServerAssignment(user.app_metadata, LIVE_CONSOLE_OPERATOR_IDS_KEY, serverId)) {
        return "operator";
    }
    return null;
}
