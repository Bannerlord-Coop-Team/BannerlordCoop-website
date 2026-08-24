import "server-only";

import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function getServerDisplayNames(serverIds: readonly string[]) {
    const uniqueServerIds = [...new Set(serverIds)];
    if (uniqueServerIds.length === 0) return new Map<string, string>();

    try {
        const supabase = getSupabaseAdminClient();
        const { data, error } = await supabase
            .from("server_settings")
            .select("server_id, display_name")
            .in("server_id", uniqueServerIds);
        if (error) throw error;

        return new Map(
            (data ?? []).map((settings) => [
                String(settings.server_id),
                String(settings.display_name),
            ]),
        );
    } catch (error) {
        console.error("Server display names failed to load", error);
        return new Map<string, string>();
    }
}

export async function saveServerDisplayName({
    displayName,
    serverId,
    updatedBy,
}: {
    displayName: string;
    serverId: string;
    updatedBy: string;
}) {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.from("server_settings").upsert({
        display_name: displayName,
        server_id: serverId,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
    }, {
        onConflict: "server_id",
    });
    if (error) throw error;
}
