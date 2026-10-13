import { beforeEach, expect, it, vi } from "vitest";
const { getUserById, listUsers } = vi.hoisted(() => ({ getUserById: vi.fn(), listUsers: vi.fn() }));
vi.mock("@/app/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ auth: { admin: { getUserById, listUsers } } }) }));
import { getWebsiteAccount } from "./users";
const accountId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => vi.resetAllMocks());
it("resolves a displayed owner with exactly one Auth request and no directory pages", async () => {
    getUserById.mockResolvedValue({ data: { user: { id: accountId, email: "owner@example.test", identities: [], user_metadata: {} } }, error: null });
    expect(await getWebsiteAccount(accountId)).toEqual({ accountId, label: "owner@example.test", email: "owner@example.test", discordUserId: null });
    expect(getUserById).toHaveBeenCalledExactlyOnceWith(accountId);
    expect(listUsers).not.toHaveBeenCalled();
});
it("does not enumerate accounts to resolve a legacy owner or recover an unavailable label", async () => {
    expect(await getWebsiteAccount("192469416892432384")).toBeNull();
    expect(getUserById).not.toHaveBeenCalled();
    getUserById.mockResolvedValue({ data: { user: null }, error: new Error("Unavailable") });
    await expect(getWebsiteAccount(accountId)).rejects.toThrow("Unavailable");
    expect(listUsers).not.toHaveBeenCalled();
});
