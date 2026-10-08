import { beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import messages from "@/app/lib/localization/dictionaries/en/managed-server.json";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), request: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/localization/server", () => ({ getTranslations: async () => createTranslator("en", messages) }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({ ...await original<object>(), requestMyServerDeletion: mocks.request }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { deleteManagedServer } from "./server-deletion-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
const intent = { serverId: "aaaaaaaa-1111-4111-8111-111111111111", expectedUpdatedAt: "2026-10-07T12:00:00.000Z",
    confirmationText: "The Northern March", requestId: "bbbbbbbb-1111-4111-8111-111111111111" };
function auth(userId = "account-a", sessionId = userId) { return { auth: {
    getUser: async () => ({ data: { user: { id: userId } } }),
    getSession: async () => ({ data: { session: { user: { id: sessionId }, access_token: "synthetic-token" } } }),
} }; }
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(auth()); mocks.request.mockResolvedValue({ outcome: "enqueued", jobId: intent.serverId, action: "delete" }); });
it("authenticates each retry, preserves intent, and reports queued rather than completed deletion", async () => {
    expect(await deleteManagedServer(intent)).toMatchObject({ ok: true, message: expect.stringContaining("still pending") });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith("synthetic-token", intent);
    expect(mocks.revalidate).toHaveBeenCalledWith("/servers");
});
it("rejects role claims and invalid confirmation before authenticating", async () => {
    for (const invalid of [{ ...intent, actor: "owner" }, { ...intent, confirmationText: "" }, { ...intent, expectedUpdatedAt: "today" }])
        expect(await deleteManagedServer(invalid)).toMatchObject({ ok: false, rejected: true });
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects a session belonging to a different authenticated account", async () => {
    mocks.auth.mockResolvedValue(auth("account-a", "account-b"));
    expect(await deleteManagedServer(intent)).toMatchObject({ ok: false, rejected: true }); expect(mocks.request).not.toHaveBeenCalled();
});
it("retains unknown outcomes and never resubmits or upgrades a stale generation automatically", async () => {
    mocks.request.mockRejectedValueOnce(new Error("lost response"));
    expect(await deleteManagedServer(intent)).toMatchObject({ ok: false, rejected: false }); expect(mocks.request).toHaveBeenCalledOnce();
    mocks.request.mockRejectedValueOnce(new MyServersApiError("stale_interaction", "stale"));
    expect(await deleteManagedServer(intent)).toMatchObject({ ok: false, rejected: true }); expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[1][1]).toEqual(intent);
});

it("treats a busy server as a definitive rejection instead of an uncertain deletion", async () => {
    mocks.request.mockRejectedValueOnce(new MyServersApiError("operation_in_progress", "The server is changing."));
    expect(await deleteManagedServer(intent)).toMatchObject({
        ok: false,
        rejected: true,
        message: "The server can't be deleted at the moment. Please try again later",
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
});
