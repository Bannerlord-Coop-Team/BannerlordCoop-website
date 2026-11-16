import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBoostyStatus, type BoostyStatus } from "../../../../supabase/functions/_shared/boosty-account";

/** The account page reads Boosty status only when the website server is configured for it. */
export function boostyStatusEnabled(): boolean {
    return process.env.BOOSTY_STATUS_ENABLED === "true";
}

/** Reads the viewer's Boosty status from the website-account Edge function. */
export async function readBoostyStatus(supabase: SupabaseClient, accessToken: string): Promise<BoostyStatus> {
    const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${accessToken}` }, body: { operation: "boosty-status" } });
    if (error) throw new Error("Boosty status unavailable");
    return parseBoostyStatus(data);
}
