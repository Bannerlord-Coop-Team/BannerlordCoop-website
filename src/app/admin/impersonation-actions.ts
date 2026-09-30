"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { legacyDiscordIdentity, requireImpersonationActor, resolveImpersonation } from "@/app/lib/auth/impersonation";
import { IMPERSONATION_COOKIE, IMPERSONATION_OPTIONS, IMPERSONATION_SECONDS, signImpersonation } from "@/app/lib/auth/impersonation-cookie";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { parseMyServersReadRequest } from "../../../supabase/functions/_shared/my-servers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function startImpersonation(form: FormData) {
    const targetId = form.get("userId");
    if (typeof targetId !== "string" || !UUID.test(targetId)) redirect("/admin?error=Invalid+member");
    try {
        const actor = await requireImpersonationActor(await getSupabaseServerClient({ impersonation: "actor" }));
        if (actor.user.id === targetId) throw new Error("Select another member.");
        const { data, error } = await getSupabaseAdminClient().auth.admin.getUserById(targetId);
        if (error || !data.user || data.user.id !== targetId) throw new Error("Member unavailable.");
        const id = crypto.randomUUID();
        // Records the real administrator and selected account in the durable audit
        // before enabling the view, and verifies the backend supports this feature.
        await requestControlPlaneAdmin({ accessToken: actor.session.access_token, operation: "view-as-user", requestId: id,
            input: { accountId: targetId, legacyDiscordUserId: legacyDiscordIdentity(data.user),
                request: { version: 1, requestId: id, operation: "my-servers", input: { cursor: null, limit: 1 } } } });
        const issuedAt = Date.now();
        const value = signImpersonation({ id, actorId: actor.user.id, actorSessionId: actor.sessionId, targetId,
            issuedAt, expiresAt: issuedAt + IMPERSONATION_SECONDS * 1000 }, process.env.SUPABASE_SECRET_KEY ?? "");
        (await cookies()).set(IMPERSONATION_COOKIE, value, IMPERSONATION_OPTIONS);
    } catch {
        redirect("/admin?error=Impersonation+could+not+start.+Check+your+admin+session+and+the+control-plane+connection.");
    }
    revalidatePath("/", "layout");
    redirect("/servers");
}

export async function stopImpersonation() {
    // Always allow exit, even after expiry, target deletion, or admin revocation.
    // __Host- cookies require Secure and Path=/ on the expiry write too.
    (await cookies()).set(IMPERSONATION_COOKIE, "", { ...IMPERSONATION_OPTIONS, maxAge: 0 });
    revalidatePath("/", "layout");
    redirect("/admin");
}

export async function readImpersonatedServers(marker: string, query: string): Promise<unknown> {
    if (typeof query !== "string" || query.length > 4096 || typeof marker !== "string" || marker.length > 64) throw new Error("Invalid preview request.");
    const cookie = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
    if (!cookie) throw new Error("Impersonation ended. Refresh the page.");
    const actor = await resolveImpersonation(await getSupabaseServerClient({ impersonation: "actor" }), cookie);
    if (marker !== `view-as:${actor.selection.id}`) throw new Error("The selected user changed. Refresh the page.");
    const request = parseMyServersReadRequest(new Request(`https://preview.invalid/?${query}`));
    if (!["my-servers", "server-onboarding", "server-backups", "server-backup-status", "server-update-status", "server-files", "file-transfer-status"].includes(request.operation)) {
        throw new Error("This operation is unavailable during read-only impersonation.");
    }
    const requestId = crypto.randomUUID();
    return requestControlPlaneAdmin({ accessToken: actor.session.access_token, operation: "view-as-user", requestId,
        input: { accountId: actor.target.id, legacyDiscordUserId: legacyDiscordIdentity(actor.target),
            request: { version: 1, requestId, ...request } } });
}
