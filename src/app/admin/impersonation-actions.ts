"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getSupabaseServerClient } from "@/app/lib/supabase/server";
import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { requireImpersonationActor, revokeImpersonatedSession } from "@/app/lib/auth/impersonation";
import { ADMIN_COOKIE_PREFIX, IMPERSONATION_COOKIE, IMPERSONATION_OPTIONS, IMPERSONATION_SECONDS, authSessionId, signImpersonation, verifyImpersonation, type Impersonation } from "@/app/lib/auth/impersonation-cookie";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
async function endSelection(selection: { id: string | null; actorId: string; actorSessionId: string }) {
    const { error } = await getSupabaseAdminClient().rpc("website_impersonation_end", {
        p_id: selection.id, p_actor_id: selection.actorId, p_actor_session_id: selection.actorSessionId, p_request_id: crypto.randomUUID(),
    });
    if (error) throw new Error("Impersonation could not be ended. Retry Exit.");
}
export async function startImpersonation(form: FormData) {
    if (process.env.ADMIN_IMPERSONATION_ENABLED !== "true") redirect("/admin?error=User+impersonation+is+not+enabled.");
    const input = form.get("userId");
    const targetId = typeof input === "string" ? input.trim().toLowerCase() : "";
    if (!UUID.test(targetId)) redirect("/admin?error=Invalid+member");
    let selection: Impersonation | undefined;
    let issuedToken: string | undefined;
    try {
        const actor = await requireImpersonationActor(await getSupabaseServerClient({ impersonation: "actor" }));
        if (actor.user.id === targetId) throw new Error("Select another member.");
        const admin = getSupabaseAdminClient();
        const { data, error } = await admin.auth.admin.getUserById(targetId);
        if (error || !data.user?.email || data.user.id !== targetId) throw new Error("Member unavailable.");
        const id = crypto.randomUUID(), issuedAt = Date.now();
        const begun = await admin.rpc("website_impersonation_begin", { p_id: id, p_actor_id: actor.user.id, p_actor_session_id: actor.sessionId, p_target_id: targetId });
        if (begun.error) throw new Error("Impersonation unavailable.");
        selection = { id, actorId: actor.user.id, actorSessionId: actor.sessionId, targetId, targetSessionId: id, issuedAt, expiresAt: issuedAt + IMPERSONATION_SECONDS * 1000 };
        // Generate and consume an OTP server-side. No email is sent and the
        // service-role client never adopts the member's credentials.
        const link = await admin.auth.admin.generateLink({ type: "magiclink", email: data.user.email });
        if (link.error || link.data.user.id !== targetId) throw new Error("Member changed.");
        const transient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        const verified = await transient.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
        issuedToken = verified.data.session?.access_token;
        if (verified.error || !verified.data.session || verified.data.user?.id !== targetId) throw new Error("Member session unavailable.");
        selection.targetSessionId = authSessionId(verified.data.session.access_token);
        const bound = await admin.rpc("website_impersonation_bind", { p_id: id, p_actor_id: actor.user.id, p_actor_session_id: actor.sessionId, p_target_session_id: selection.targetSessionId });
        if (bound.error) throw new Error("Session registration unavailable.");
        const current = await createSupabaseServerClient();
        const oldCookie = (await cookies()).get(IMPERSONATION_COOKIE);
        if (oldCookie) {
            const previous = verifyImpersonation(oldCookie.value, process.env.SUPABASE_SECRET_KEY ?? "", true);
            await endSelection(previous);
            const old = (await current.auth.getSession()).data.session;
            if (old && authSessionId(old.access_token) === previous.targetSessionId) await revokeImpersonatedSession(old.access_token);
        }
        const saved = await (await createSupabaseServerClient(true)).auth.setSession(actor.session);
        if (saved.error) throw new Error("Administrator session could not be saved.");
        (await cookies()).set(IMPERSONATION_COOKIE, signImpersonation(selection, process.env.SUPABASE_SECRET_KEY ?? ""), IMPERSONATION_OPTIONS);
        const adopted = await current.auth.setSession(verified.data.session);
        if (adopted.error) throw new Error("Member session could not be opened.");
    } catch {
        if (selection) await endSelection(selection).catch(() => undefined);
        if (issuedToken) await revokeImpersonatedSession(issuedToken).catch(() => undefined);
        redirect("/admin?error=Impersonation+could+not+start.+Check+your+admin+session+and+try+again.");
    }
    revalidatePath("/", "layout");
    redirect("/servers");
}

export async function stopImpersonation() {
    const jar = await cookies();
    const cookie = jar.get(IMPERSONATION_COOKIE);
    if (!cookie) redirect("/admin");
    let selection: Impersonation | undefined;
    try { selection = verifyImpersonation(cookie.value, process.env.SUPABASE_SECRET_KEY ?? "", true); } catch { /* Recover with the independently verified backup. */ }
    const savedActor = await getSupabaseServerClient({ impersonation: "actor" }).then(client => requireImpersonationActor(client, false)).catch(() => null);
    if (selection) await endSelection(selection);
    else if (savedActor) await endSelection({ id: null, actorId: savedActor.user.id, actorSessionId: savedActor.sessionId });
    const current = await createSupabaseServerClient();
    const target = (await current.auth.getSession()).data.session;
    if (target && (!selection || authSessionId(target.access_token) === selection.targetSessionId)) {
        // Never use global sign-out: the member's own sessions are independent.
        await revokeImpersonatedSession(target.access_token);
    }
    const backup = savedActor && (!selection || (savedActor.user.id === selection.actorId && savedActor.sessionId === selection.actorSessionId)) ? savedActor.session : null;
    if (backup) {
        const restored = await current.auth.setSession(backup);
        if (restored.error) throw new Error("Your admin session could not be restored. Retry Exit.");
    } else await current.auth.signOut({ scope: "local" });
    for (const { name } of jar.getAll()) if (name === IMPERSONATION_COOKIE || name === ADMIN_COOKIE_PREFIX || name.startsWith(`${ADMIN_COOKIE_PREFIX}.`)) {
        jar.set(name, "", { ...IMPERSONATION_OPTIONS, maxAge: 0 });
    }
    revalidatePath("/", "layout");
    redirect(backup ? "/admin" : "/login");
}
