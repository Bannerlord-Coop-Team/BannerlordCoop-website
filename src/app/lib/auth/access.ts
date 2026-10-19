import "server-only";

import {
    hasServerDashboardAccess,
    isMemberRole,
    type MemberRole,
} from "@/app/lib/auth/roles";
import type { User } from "@supabase/supabase-js";

// Reads the configured bootstrap administrator email allowlist.
function adminEmails() {
    return new Set(
        (process.env.SUPABASE_ADMIN_EMAILS ?? "")
            .split(",")
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean),
    );
}

// Identifies an administrator explicitly allowlisted by email.
export function isBootstrapAdmin(email: string | undefined) {
    return Boolean(email && adminEmails().has(email.toLowerCase()));
}

// Resolves the trusted member role, preserving bootstrap administrator access.
export function getMemberRole(user: User): MemberRole {
    if (isBootstrapAdmin(user.email)) return "Admin";

    const role = user.app_metadata.role;
    return isMemberRole(role) ? role : "User";
}

// Checks access to member administration.
export function hasAdminAccess(user: User) {
    return getMemberRole(user) === "Admin";
}

// Checks access to the fictional hosting preview dashboard.
export function hasHostedServerAccess(user: User) {
    return hasServerDashboardAccess(getMemberRole(user));
}
