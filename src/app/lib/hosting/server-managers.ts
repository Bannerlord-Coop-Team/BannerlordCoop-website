import "server-only";
import { getMyServerManagers, type MyServerManagerGrant } from "./my-servers-server";
import { getWebsiteAccount, type WebsiteAccountSummary } from "@/app/lib/supabase/users";

/** A manager as the owner sees it: a readable label, or null when the account no longer resolves. */
export type ServerManager = { accountId: string; label: string | null; removable: boolean };

/** The reads this module depends on, injectable so tests need neither the control plane nor Supabase Auth. */
export type ServerManagerSources = {
    listGrants: (accessToken: string, serverId: string, signal?: AbortSignal) => Promise<MyServerManagerGrant[]>;
    findAccount: (accountId: string) => Promise<WebsiteAccountSummary | null>;
};

const WEBSITE_ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const defaultSources: ServerManagerSources = {
    listGrants: (accessToken, serverId, signal) => getMyServerManagers(accessToken, serverId, signal),
    findAccount: (accountId) => getWebsiteAccount(accountId),
};

/** Lists one server's managers with their account labels; the owner already knows each email, having entered it. */
export async function listServerManagers(accessToken: string, serverId: string, signal?: AbortSignal, sources = defaultSources): Promise<ServerManager[]> {
    const grants = await sources.listGrants(accessToken, serverId, signal);
    return await Promise.all(grants.map(async ({ accountId }) => ({
        accountId,
        label: await accountLabel(accountId, sources),
        // Only website accounts can be revoked here; the owner API addresses managers by account UUID.
        removable: WEBSITE_ACCOUNT_ID.test(accountId),
    })));
}

// One failed or missing lookup leaves that row unlabeled instead of hiding the whole list.
async function accountLabel(accountId: string, sources: ServerManagerSources) {
    if (!WEBSITE_ACCOUNT_ID.test(accountId)) return null;
    try { return (await sources.findAccount(accountId))?.label ?? null; }
    catch { return null; }
}
