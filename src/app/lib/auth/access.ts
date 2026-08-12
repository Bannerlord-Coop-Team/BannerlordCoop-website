import "server-only";

import {
    hasServerDashboardAccess,
    isMemberRole,
    type MemberRole,
} from "@/app/lib/auth/roles";
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
