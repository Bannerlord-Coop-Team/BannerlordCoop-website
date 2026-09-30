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

// Recognizes the supported trusted member role values.
export function isMemberRole(value: unknown): value is MemberRole {
    return typeof value === "string" && MEMBER_ROLES.includes(value as MemberRole);
}

// Checks fleet access for the fictional hosting preview.
export function hasServerFleetAccess(role: MemberRole) {
    return role === "Admin" || role === "Server Manager";
}

// Identifies the two subscriber hosting preview roles.
export function isServerCustomerRole(role: MemberRole): role is ServerCustomerRole {
    return role === "Standard Server" || role === "Premium Server";
}

// Checks fleet or subscriber access to the hosting preview dashboard.
export function hasServerDashboardAccess(role: MemberRole) {
    return hasServerFleetAccess(role) || isServerCustomerRole(role);
}
