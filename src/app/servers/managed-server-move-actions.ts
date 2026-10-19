"use server";

import type { MyServerMove } from "@/app/lib/control-plane/types";
import { getMyServerMoveStatus } from "@/app/lib/hosting/my-servers-server";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";

export type ManagedServerMoveStatusResult = { ok: true; move: MyServerMove | null } | { ok: false };

/**
 * Reauthenticates each move-status read; the control plane checks current server access. Failures are quiet
 * (including an older control plane without the read), so the page keeps the move status it last showed.
 */
export async function readManagedServerMoveStatus(serverId: unknown): Promise<ManagedServerMoveStatusResult> {
    if (typeof serverId !== "string" || !REQUEST_ID.test(serverId)) return { ok: false };
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session || session.user.id !== user.id) return { ok: false };
        return { ok: true, move: await getMyServerMoveStatus(session.access_token, serverId, AbortSignal.timeout(10_000)) };
    } catch {
        return { ok: false };
    }
}
