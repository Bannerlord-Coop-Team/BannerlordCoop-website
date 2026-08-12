export const MEMBER_ROLES = ["Admin", "Developer", "Helper", "User"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export function isMemberRole(value: unknown): value is MemberRole {
    return typeof value === "string" && MEMBER_ROLES.includes(value as MemberRole);
}
