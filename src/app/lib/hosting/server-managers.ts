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

// Matches the account IDs the owner API's set-server-manager accepts, so every Remove button can succeed.
const REMOVABLE_ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const defaultSources: ServerManagerSources = {
    listGrants: (accessToken, serverId, signal) => getMyServerManagers(accessToken, serverId, signal),
    findAccount: (accountId) => getWebsiteAccount(accountId),
};

/**
 * Lists one server's managers with each account's current label, for the owner who granted them.
 * The signal bounds the account lookups as well as the grant read.
 */
export async function listServerManagers(accessToken: string, serverId: string, signal?: AbortSignal, sources = defaultSources): Promise<ServerManager[]> {
    const grants = await sources.listGrants(accessToken, serverId, signal);
    const managers = Promise.all(grants.map(async ({ accountId }) => ({
        accountId,
        label: await accountLabel(accountId, sources),
        // Only website accounts can be revoked here; the owner API addresses managers by account UUID.
        removable: REMOVABLE_ACCOUNT_ID.test(accountId),
    })));
    return await untilAborted(managers, signal);
}

// Labels by email only, never a phone number; one failed or missing lookup leaves just that row unlabeled.
async function accountLabel(accountId: string, sources: ServerManagerSources) {
    if (!REMOVABLE_ACCOUNT_ID.test(accountId)) return null;
    try { return (await sources.findAccount(accountId))?.email ?? null; }
    catch { return null; }
}

// Settles with the work, or rejects as soon as the signal aborts; the lookups themselves take no signal.
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return work;
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}
