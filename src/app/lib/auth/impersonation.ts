import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { hasAdminAccess } from "./access";
import { getSupabaseAdminClient } from "../supabase/admin";
import { authSessionId, READ_ONLY_MESSAGE, verifyImpersonation } from "./impersonation-cookie";

export async function requireImpersonationActor(client: SupabaseClient) {
    const [{ data: { user }, error }, { data: { session }, error: sessionError }] = await Promise.all([
        client.auth.getUser(), client.auth.getSession(),
    ]);
    if (error || sessionError || !user || !session || session.user.id !== user.id || !hasAdminAccess(user)) {
        throw new Error("A current administrator session is required.");
    }
    return { user, session, sessionId: authSessionId(session.access_token) };
}

export async function resolveImpersonation(client: SupabaseClient, cookie: string) {
    const actor = await requireImpersonationActor(client);
    const selection = verifyImpersonation(cookie, process.env.SUPABASE_SECRET_KEY ?? "", actor.user.id, actor.sessionId);
    const { data, error } = await getSupabaseAdminClient().auth.admin.getUserById(selection.targetId);
    if (error || !data.user || data.user.id !== selection.targetId) throw new Error("The selected user is unavailable.");
    return { ...actor, selection, target: data.user };
}

/** Only verified provider identities can select a legacy hosting principal. */
export function legacyDiscordIdentity(user: User): string | null {
    const ids = new Set<string>();
    for (const identity of user.identities ?? []) {
        if (identity.provider !== "discord") continue;
        for (const id of [identity.id, identity.identity_data?.provider_id, identity.identity_data?.sub, identity.identity_data?.id]) {
            if (typeof id === "string" && /^[1-9][0-9]{16,19}$/u.test(id)) ids.add(id);
        }
    }
    return ids.size === 1 ? [...ids][0] : null;
}

/** The preview facade exposes no administrator token, refresh token, or writable SDK method. */
export async function impersonatedClient(client: SupabaseClient, cookie: string): Promise<SupabaseClient> {
    const { selection, target, session } = await resolveImpersonation(client, cookie);
    const readOnly = () => { throw new Error(READ_ONLY_MESSAGE); };
    const auth = {
        getUser: async () => ({ data: { user: target }, error: null }),
        getSession: async () => ({ data: { session: {
            user: target, access_token: `view-as:${selection.id}`, refresh_token: "", token_type: "bearer",
            expires_at: selection.expiresAt / 1000, expires_in: Math.max(0, Math.floor((selection.expiresAt - Date.now()) / 1000)),
        } }, error: null }),
    };
    return new Proxy(client, { get(_client, property) {
        if (property === "then") return undefined;
        if (property === "auth") return new Proxy(auth, { get(value, key) { return value[key as keyof typeof auth] ?? readOnly; } });
        if (property === "functions") return { invoke: async (name: string, options: { body?: { operation?: string } }) => {
            if (name !== "website-account" || options?.body?.operation !== "status" || Object.keys(options.body).length !== 1) return readOnly();
            return client.functions.invoke("website-account", {
                headers: { Authorization: `Bearer ${session.access_token}` },
                body: { operation: "preview-status", accountId: target.id },
            });
        } };
        return readOnly;
    } });
}
