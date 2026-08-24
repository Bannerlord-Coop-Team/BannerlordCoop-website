export const MEMBER_ROLES = [
    "Admin",
    "Server Manager",
    "Standard Server",
    "Premium Server",
    "Developer",
    "Helper",
    "User",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];
export type ServerCustomerRole = Extract<
    MemberRole,
    "Standard Server" | "Premium Server"
>;

export function isMemberRole(value: unknown): value is MemberRole {
    return typeof value === "string" && MEMBER_ROLES.includes(value as MemberRole);
}

export function hasServerFleetAccess(role: MemberRole) {
    return role === "Admin" || role === "Server Manager";
}

export function hasLiveConsoleAccess(role: MemberRole) {
    return role === "Admin";
}

export function isServerCustomerRole(role: MemberRole): role is ServerCustomerRole {
    return role === "Standard Server" || role === "Premium Server";
}

export function hasServerDashboardAccess(role: MemberRole) {
    return hasServerFleetAccess(role) || isServerCustomerRole(role);
}
