import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBoostyLinkStatus, type BoostyLinkStatus } from "../../../../supabase/functions/_shared/boosty-account";
import { LINK_CODE } from "../../../../supabase/functions/_shared/boosty-link-code";

// The code is shown once after issuing; only this httpOnly cookie remembers it for its 30 minutes.
export const BOOSTY_CODE_COOKIE = "__Host-boosty-link-code";
export const BOOSTY_CODE_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 1800 };

/** Boosty linking stays hidden unless the website server is explicitly configured for it. */
export function boostyLinkingEnabled(): boolean {
    return process.env.BOOSTY_LINKING_ENABLED === "true";
}

/** Reads the viewer's Boosty link status; a code is sent only so the Edge can say whether it is the pending one. */
export async function readBoostyLinkStatus(supabase: SupabaseClient, accessToken: string, code: string | undefined): Promise<BoostyLinkStatus> {
    const body = code !== undefined && LINK_CODE.test(code) ? { operation: "boosty-status", code } : { operation: "boosty-status" };
    const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${accessToken}` }, body });
    if (error) throw new Error("Boosty status unavailable");
    return parseBoostyLinkStatus(data);
}
