import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { removeServerManager, setServerManager } from "./server-manager-actions";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), set: vi.fn(), summary: vi.fn(), find: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/supabase/users", () => ({ findWebsiteAccountByEmail: mocks.find }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({ ...await original<typeof import("@/app/lib/hosting/my-servers")>(), requestMyServerManager: mocks.set }));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({ getMyServerSummary: mocks.summary }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));

const serverId = "11111111-1111-4111-8111-111111111111";
const managerAccountId = "22222222-2222-4222-8222-222222222222";
const current = { serverId, accessRole: "owner", updatedAt: "2026-10-01T00:00:05.000Z" };

// Builds the form a client component submits.
function form(fields: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "verified-token" } } }) } });
    mocks.summary.mockResolvedValue(current);
    mocks.set.mockResolvedValue({ changed: true });
    mocks.find.mockResolvedValue({ accountId: managerAccountId, label: "friend@example.com", email: "friend@example.com", discordUserId: null });
});

it("revokes the listed manager at the freshly read server generation and refreshes the pages", async () => {
    const result = await removeServerManager(form({ serverId, managerAccountId: managerAccountId.toUpperCase(), expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }));
    expect(result).toEqual({ ok: true, message: "Manager access removed. The account can no longer manage this server." });
    expect(mocks.summary).toHaveBeenCalledExactlyOnceWith("verified-token", serverId);
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith("verified-token",
        { serverId, managerAccountId, enabled: false, expectedUpdatedAt: current.updatedAt }, expect.any(String));
    expect(mocks.revalidate).toHaveBeenCalledWith(`/servers/${serverId}`);
});

it("reports an already-removed manager without treating it as a failure", async () => {
    mocks.set.mockResolvedValue({ changed: false });
    expect(await removeServerManager(form({ serverId, managerAccountId }))).toEqual({ ok: true, message: "That account no longer has manager access." });
});

it("rejects malformed IDs before reading the session", async () => {
    const malformed: Record<string, string>[] = [{ serverId: "nope", managerAccountId }, { serverId, managerAccountId: "123456789012345678" }, { serverId }];
    for (const fields of malformed) {
        expect(await removeServerManager(form(fields))).toMatchObject({ ok: false });
    }
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
});

it("refuses a manager or a mismatched session without changing access or revalidating", async () => {
    mocks.summary.mockResolvedValueOnce({ ...current, accessRole: "manager" });
    expect(await removeServerManager(form({ serverId, managerAccountId }))).toEqual({ ok: false, message: "Only the server owner can change manager access." });
    mocks.auth.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "someone-else" }, access_token: "stale-token" } } }) } });
    expect(await removeServerManager(form({ serverId, managerAccountId }))).toMatchObject({ ok: false });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("keeps backend failures generic and asks for sign-in only when the token was rejected", async () => {
    mocks.set.mockRejectedValueOnce(new MyServersApiError("request_conflict", "Conflict"));
    expect(await removeServerManager(form({ serverId, managerAccountId }))).toEqual({ ok: false, message: "The manager access change could not be confirmed. Refresh and try again." });
    mocks.set.mockRejectedValueOnce(new MyServersApiError("unauthenticated", "Expired"));
    expect((await removeServerManager(form({ serverId, managerAccountId }))).message).toMatch(/sign in/iu);
    expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("grants the exact-email account through the same owner check", async () => {
    expect(await setServerManager(form({ serverId, managerEmail: " Friend@Example.com " }))).toMatchObject({ ok: true });
    expect(mocks.find).toHaveBeenCalledExactlyOnceWith("friend@example.com");
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith("verified-token",
        { serverId, managerAccountId, enabled: true, expectedUpdatedAt: current.updatedAt }, expect.any(String));
    mocks.find.mockResolvedValueOnce(null);
    expect(await setServerManager(form({ serverId, managerEmail: "missing@example.com" }))).toMatchObject({ ok: false });
    expect(mocks.set).toHaveBeenCalledOnce();
});
