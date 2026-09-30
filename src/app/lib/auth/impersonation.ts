import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authSessionId, verifyImpersonation } from "./impersonation-cookie";

export async function requireImpersonationActor(client: SupabaseClient, requireAdmin = true) {
    const [{ data: { user }, error }, { data: { session }, error: sessionError }] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);
    if (error || sessionError || !user || !session || session.user.id !== user.id
        || (requireAdmin && user.app_metadata.role !== "Admin")) throw new Error("A current administrator session is required.");
    return { user, session, sessionId: authSessionId(session.access_token) };
}
export async function resolveImpersonation(actorClient: SupabaseClient, targetClient: SupabaseClient, cookie: string) {
    const selection = verifyImpersonation(cookie, process.env.SUPABASE_SECRET_KEY ?? "");
    const actor = await requireImpersonationActor(actorClient);
    const target = await requireImpersonationActor(targetClient, false);
    if (selection.actorId !== actor.user.id || selection.actorSessionId !== actor.sessionId
        || selection.targetId !== target.user.id || selection.targetSessionId !== target.sessionId) throw new Error("The impersonation session changed.");
    const { data, error } = await targetClient.rpc("website_session_context", { p_action: "website.impersonation", p_request_id: crypto.randomUUID() });
    if (error || data?.impersonationId !== selection.id || data.actorId !== actor.user.id || data.targetId !== target.user.id) throw new Error("Impersonation ended or is unavailable.");
    return { ...actor, selection, target: target.user };
}

/** OAuth identity linking may issue another native session for the same user. */
export async function bindLinkedImpersonationSession(client: SupabaseClient, previousAccessToken: string) {
    const { cookies } = await import("next/headers");
    const { IMPERSONATION_COOKIE, IMPERSONATION_OPTIONS, signImpersonation } = await import("./impersonation-cookie");
    const jar = await cookies(), cookie = jar.get(IMPERSONATION_COOKIE);
    if (!cookie) return;
    try {
        const selection = verifyImpersonation(cookie.value, process.env.SUPABASE_SECRET_KEY ?? "");
        const { createSupabaseServerClient } = await import("../supabase/server");
        const actor = await requireImpersonationActor(await createSupabaseServerClient(true));
        const target = await requireImpersonationActor(client, false);
        if (actor.user.id !== selection.actorId || actor.sessionId !== selection.actorSessionId || target.user.id !== selection.targetId || authSessionId(previousAccessToken) !== selection.targetSessionId) throw new Error("OAuth account changed.");
        const { getSupabaseAdminClient } = await import("../supabase/admin");
        const { error } = await getSupabaseAdminClient().rpc("website_impersonation_bind", {
            p_id: selection.id, p_actor_id: actor.user.id, p_actor_session_id: actor.sessionId, p_target_session_id: target.sessionId,
        });
        if (error) throw new Error("Linked session registration failed.");
        if (target.sessionId !== selection.targetSessionId) await revokeImpersonatedSession(previousAccessToken);
        jar.set(IMPERSONATION_COOKIE, signImpersonation({ ...selection, targetSessionId: target.sessionId }, process.env.SUPABASE_SECRET_KEY ?? ""), IMPERSONATION_OPTIONS);
    } catch (error) {
        // PKCE may have already installed a new session. Never leave an
        // unregistered login in the browser if binding it to the grant fails.
        await client.auth.signOut({ scope: "local" });
        throw error;
    }
}

/** Match native local sign-out semantics, but retain Exit on upstream failure. */
export async function revokeImpersonatedSession(accessToken: string) {
    const { getSupabaseAdminClient } = await import("../supabase/admin");
    const { error } = await getSupabaseAdminClient().auth.admin.signOut(accessToken, "local");
    if (error && ![401, 403, 404].includes(error.status ?? 0) && error.name !== "AuthSessionMissingError") {
        throw new Error("The user session could not be closed. Retry Exit.");
    }
}
