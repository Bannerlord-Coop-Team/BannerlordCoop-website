import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { setServerVisibility } from "./server-visibility-actions";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), set: vi.fn(), list: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({ ...await original<typeof import("@/app/lib/hosting/my-servers")>(), requestServerVisibility: mocks.set }));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({ listAllMyServers: mocks.list }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));

const serverId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const input = { serverId, visibility: "private", expectedUpdatedAt: "2026-10-01T00:00:00.000Z", requestId };
const current = { serverId, accessRole: "owner", visibility: "public", updatedAt: "2026-10-01T00:00:05.000Z" };

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "verified-token" } } }) } });
    mocks.set.mockResolvedValue({ outcome: "updated", serverId, visibility: "private", updatedAt: "2026-10-01T00:00:06.000Z" });
    mocks.list.mockResolvedValue([current]);
});

it("applies the owner's choice once at the current revision when another write advanced the server", async () => {
    mocks.set.mockRejectedValueOnce(new MyServersApiError("request_conflict", "Conflict"));
    expect(await setServerVisibility(input)).toMatchObject({ ok: true, updatedAt: "2026-10-01T00:00:06.000Z" });
    expect(mocks.set).toHaveBeenCalledTimes(2);
    const [, retryInput, retryId] = mocks.set.mock.calls[1];
    expect(retryInput).toMatchObject({ serverId, visibility: "private", expectedUpdatedAt: current.updatedAt });
    expect(retryId).not.toBe(requestId);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/servers/${serverId}`);
});

it("acknowledges without writing when the server already has the requested visibility", async () => {
    mocks.set.mockRejectedValueOnce(new MyServersApiError("stale_interaction", "Stale"));
    mocks.list.mockResolvedValue([{ ...current, visibility: "private" }]);
    expect(await setServerVisibility(input)).toMatchObject({ ok: true, updatedAt: current.updatedAt });
    expect(mocks.set).toHaveBeenCalledTimes(1);
});

it("explains a conflict as a changed server, never as an ownership problem, when the retry cannot apply", async () => {
    mocks.set.mockRejectedValue(new MyServersApiError("request_conflict", "Conflict"));
    const result = await setServerVisibility(input);
    expect(result).toMatchObject({ ok: false, rejected: true });
    expect(result.message).not.toMatch(/owner/iu);
    expect(mocks.set).toHaveBeenCalledTimes(2);
});

it("does not retry for someone who is no longer the owner", async () => {
    mocks.set.mockRejectedValueOnce(new MyServersApiError("request_conflict", "Conflict"));
    mocks.list.mockResolvedValue([{ ...current, accessRole: "manager" }]);
    expect(await setServerVisibility(input)).toMatchObject({ ok: false, rejected: true });
    expect(mocks.set).toHaveBeenCalledTimes(1);
});

it("keeps the ownership message for authorization failures and does not retry them", async () => {
    mocks.set.mockRejectedValueOnce(new MyServersApiError("server_not_found", "Gone"));
    expect(await setServerVisibility(input)).toMatchObject({ ok: false, rejected: true });
    expect(mocks.list).not.toHaveBeenCalled();
});
