"use server";

import { createSupabaseServerClient } from "@/app/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { IMPERSONATION_COOKIE } from "@/app/lib/auth/impersonation-cookie";
import { stopImpersonation } from "@/app/admin/impersonation-actions";

export async function signOut() {
    if ((await cookies()).has(IMPERSONATION_COOKIE)) return stopImpersonation();
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/");
}
