// @vitest-environment node
import { expect, it, vi } from "vitest";
import { listServerManagers, type ServerManagerSources } from "./server-managers";

const SERVER_ID = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const DELETED = "33333333-3333-4333-8333-333333333333";
const FAILING = "44444444-4444-4444-8444-444444444444";
const DISCORD = "123456789012345678";
const grantedAt = "2026-10-01T00:00:00.000Z";

it("labels website accounts and marks only them removable, keeping rows whose lookup fails", async () => {
    const sources: ServerManagerSources = {
        listGrants: vi.fn(async () => [FRIEND, DELETED, FAILING, DISCORD].map(accountId => ({ accountId, grantedAt }))),
        findAccount: vi.fn(async (accountId: string) => {
            if (accountId === FAILING) throw new Error("Auth unavailable");
            return accountId === FRIEND ? { accountId, label: "friend@example.com", email: "friend@example.com", discordUserId: null } : null;
        }),
    };
    const signal = AbortSignal.timeout(1_000);
    expect(await listServerManagers("token", SERVER_ID, signal, sources)).toEqual([
        { accountId: FRIEND, label: "friend@example.com", removable: true },
        { accountId: DELETED, label: null, removable: true },
        { accountId: FAILING, label: null, removable: true },
        { accountId: DISCORD, label: null, removable: false },
    ]);
    expect(sources.listGrants).toHaveBeenCalledExactlyOnceWith("token", SERVER_ID, signal);
    expect(sources.findAccount).toHaveBeenCalledTimes(3);
});

it("propagates a failed grant read so the page can show the list as unavailable", async () => {
    const sources: ServerManagerSources = { listGrants: async () => { throw new Error("Unknown operation"); }, findAccount: vi.fn() };
    await expect(listServerManagers("token", SERVER_ID, undefined, sources)).rejects.toThrow("Unknown operation");
    expect(sources.findAccount).not.toHaveBeenCalled();
});

it("gives up on account lookups that outlast the page's read signal", async () => {
    const controller = new AbortController();
    const sources: ServerManagerSources = {
        listGrants: async () => [{ accountId: FRIEND, grantedAt }],
        findAccount: vi.fn(() => new Promise<never>(() => {})),
    };
    const listing = listServerManagers("token", SERVER_ID, controller.signal, sources);
    await vi.waitFor(() => expect(sources.findAccount).toHaveBeenCalledOnce());
    controller.abort(new Error("Timed out"));
    await expect(listing).rejects.toThrow("Timed out");
});
