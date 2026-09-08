import type { SupabaseClient } from "@supabase/supabase-js";

export async function updateLiveConsoleAssignment(
    client: Pick<SupabaseClient, "rpc">,
    userId: string,
    serverId: string,
    assignment: { owner?: boolean; operator?: boolean },
) {
    // Send only assignment intent. Metadata read for authorization may already
    // contain a revoked role or an outdated assignment for another server.
    const { error } = await client.rpc("set_live_console_assignment", {
        p_user_id: userId,
        p_server_id: serverId,
        p_owner_assigned: assignment.owner ?? null,
        p_operator_assigned: assignment.operator ?? null,
    });
    if (error) throw error;
}
