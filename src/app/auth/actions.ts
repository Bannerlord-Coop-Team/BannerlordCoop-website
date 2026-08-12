"use server";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signOut() {
    const supabase = await getSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/");
}
