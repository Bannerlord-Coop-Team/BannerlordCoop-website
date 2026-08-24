import "server-only";

import {
    hasServerDashboardAccess,
    isMemberRole,
    type MemberRole,
} from "@/app/lib/auth/roles";
import {
    getAssignedLiveConsoleAccess,
    type LiveConsoleAccessLevel,
} from "@/app/lib/console/access";
import type { User } from "@supabase/supabase-js";

function adminEmails() {
    return new Set(
        (process.env.SUPABASE_ADMIN_EMAILS ?? "")
            .split(",")
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean),
    );
}

export function isBootstrapAdmin(email: string | undefined) {
    return Boolean(email && adminEmails().has(email.toLowerCase()));
}

export function getMemberRole(user: User): MemberRole {
    if (isBootstrapAdmin(user.email)) return "Admin";

    const role = user.app_metadata.role;
    return isMemberRole(role) ? role : "User";
}

export function hasAdminAccess(user: User) {
    return getMemberRole(user) === "Admin";
}

export function hasHostedServerAccess(user: User) {
    return hasServerDashboardAccess(getMemberRole(user));
}

export function getLiveConsoleAccessLevel(
    user: User,
    serverId: string,
): LiveConsoleAccessLevel | null {
    if (hasAdminAccess(user)) return "admin";
    return getAssignedLiveConsoleAccess(user.app_metadata, serverId);
}

export function hasLiveConsoleServerAccess(user: User, serverId: string) {
    return getLiveConsoleAccessLevel(user, serverId) !== null;
}
