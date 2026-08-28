import "server-only";

import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { uniqueDiscordUsers } from "@/app/lib/supabase/discord-users";
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
