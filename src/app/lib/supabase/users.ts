import "server-only";

import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { discordUserSummary, uniqueDiscordUsers } from "@/app/lib/supabase/discord-users";
import type { User } from "@supabase/supabase-js";

export const AUTH_USERS_PAGE_SIZE = 1000;
export const AUTH_USERS_MAX_PAGES = 10;

export async function listSupabaseUsers() {
    const adminClient = getSupabaseAdminClient();
    const users: User[] = [];
    let truncated = false;

    for (let page = 1; page <= AUTH_USERS_MAX_PAGES; page += 1) {
        const { data, error } = await adminClient.auth.admin.listUsers({
            page,
            perPage: AUTH_USERS_PAGE_SIZE,
        });

        if (error) throw error;
        users.push(...data.users);

        if (data.users.length < AUTH_USERS_PAGE_SIZE) break;
        if (page === AUTH_USERS_MAX_PAGES) truncated = true;
    }

    return { users, truncated };
}

export async function listDiscordUsers() {
    const { users, truncated } = await listSupabaseUsers();
    return { users: uniqueDiscordUsers(users), truncated };
}

export async function listWebsiteAccounts() {
    const { users, truncated } = await listSupabaseUsers();
    return {
        users: users.map(user => ({
            accountId: user.id,
            label: user.email || user.phone || user.id,
            email: user.email || null,
            discordUserId: discordUserSummary(user)?.discordUserId ?? null,
        })),
        truncated,
    };
}
export type WebsiteAccountSummary = { accountId: string; label: string; email: string | null; discordUserId: string | null };

/** Resolves one displayed owner without enumerating the Auth directory. */
export async function getWebsiteAccount(accountId: string): Promise<WebsiteAccountSummary | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(accountId)) return null;
    const { data, error } = await getSupabaseAdminClient().auth.admin.getUserById(accountId);
    if (error) throw error;
    const user = data.user;
    return user ? { accountId: user.id, label: user.email || user.phone || user.id,
        email: user.email || null, discordUserId: discordUserSummary(user)?.discordUserId ?? null } : null;
}
