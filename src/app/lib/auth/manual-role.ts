import type { MemberRole } from "./roles";

export function manualRoleMetadata(_metadata: Record<string, unknown>, role: MemberRole) {
    // A manual Standard Server grant is independent of Patreon, including when
    // the displayed role already has the same value. Null clears Auth's marker.
    return { role, patreon_standard_server_grant: null };
}
