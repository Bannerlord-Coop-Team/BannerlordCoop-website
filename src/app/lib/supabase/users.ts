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
const VPS_OWNER_LABEL_BATCH_SIZE = 1000;

/** Resolve only the accounts present in the authorized VPS inventory. */
export async function readWebsiteOwnerLabels(accountIds: readonly string[]): Promise<Record<string, string>> {
    if (accountIds.length === 0) return {};
    const client = getSupabaseAdminClient();
    const labels: Record<string, string> = {};
    for (let offset = 0; offset < accountIds.length; offset += VPS_OWNER_LABEL_BATCH_SIZE) {
        const { data, error } = await client.rpc("admin_vps_owner_labels", {
            p_account_ids: accountIds.slice(offset, offset + VPS_OWNER_LABEL_BATCH_SIZE),
        });
        if (error) throw error;
        const rows = data as Array<{ account_id: string; label: string | null }>;
        for (const { account_id, label } of rows) if (label) labels[account_id] = label;
    }
    return labels;
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

/** Resolves one exact email on the server; callers never receive an account directory. */
export async function findWebsiteAccountByEmail(email: string): Promise<WebsiteAccountSummary | null> {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) || normalized.length > 320) return null;
    const { users } = await listSupabaseUsers();
    const user = users.find(candidate => candidate.email?.trim().toLowerCase() === normalized);
    return user ? { accountId: user.id, label: user.email || user.phone || user.id,
        email: user.email || null, discordUserId: discordUserSummary(user)?.discordUserId ?? null } : null;
}
