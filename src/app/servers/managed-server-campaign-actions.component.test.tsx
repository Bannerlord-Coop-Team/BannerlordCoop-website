import { beforeEach, expect, it, vi } from "vitest";
import { changeManagedServerCampaign, listManagedServerCampaigns } from "./managed-server-campaign-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), select: vi.fn(), reset: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/server-campaigns", () => ({ listMyServerCampaigns: mocks.list, selectMyServerCampaign: mocks.select, resetMyServerCampaign: mocks.reset }));
const id = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-10-02T12:00:00.000Z";
const page = { serverId: id, updatedAt, activeSaveId: id, items: [] };
beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), getSession: async () => ({ data: { session: { access_token: "token" } } }) } });
});
it("checks the current account before listing or changing campaigns", async () => {
    expect((await listManagedServerCampaigns(id, "previous-owner")).ok).toBe(false);
    expect((await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt }, "previous-owner")).ok).toBe(false);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.reset).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue(page);
    expect(await listManagedServerCampaigns(id, "owner")).toEqual({ ok: true, campaigns: page });
    expect(mocks.list).toHaveBeenCalledWith("token", id);
});
it("validates the mutation before sending and forwards the request identity", async () => {
    mocks.select.mockResolvedValue({ serverId: id, activeSaveId: id, updatedAt });
    expect(await changeManagedServerCampaign({ requestId: id, action: "select-save", serverId: id, saveId: id, expectedUpdatedAt: updatedAt }, "owner")).toEqual({ ok: true, selection: { serverId: id, activeSaveId: id, updatedAt } });
    expect(mocks.select).toHaveBeenCalledWith("token", id, { action: "select-save", serverId: id, saveId: id, expectedUpdatedAt: updatedAt });
    mocks.reset.mockResolvedValue({ outcome: "enqueued", jobId: id, action: "reset-campaign" });
    expect(await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt }, "owner")).toEqual({ ok: true, reset: { outcome: "enqueued", jobId: id, action: "reset-campaign" } });
    for (const invalid of [
        { requestId: "nope", action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt },
        { requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: "yesterday" },
        { requestId: id, action: "select-save", serverId: id, expectedUpdatedAt: updatedAt },
        { requestId: id, action: "delete-save", serverId: id, saveId: id, expectedUpdatedAt: updatedAt },
        { requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt, confirm: true },
    ]) expect(await changeManagedServerCampaign(invalid, "owner")).toMatchObject({ ok: false, notSubmitted: true });
    expect(mocks.select).toHaveBeenCalledTimes(1); expect(mocks.reset).toHaveBeenCalledTimes(1);
});
it("maps control plane rejections to guidance and marks state conflicts for refresh", async () => {
    for (const [code, fragment, refresh] of [
        ["safe_stop_required", "Stop the server", true],
        ["operation_in_progress", "still running", true],
        ["stale_interaction", "changed since this page loaded", true],
        ["server_not_found", "unavailable or your access changed", false],
        ["control_plane_unavailable", "could not be reached", false],
    ] as const) {
        mocks.reset.mockRejectedValueOnce(new MyServersApiError(code, "Rejected"));
        expect(await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt }, "owner"))
            .toMatchObject({ ok: false, notSubmitted: false, refresh, message: expect.stringContaining(fragment) });
    }
    mocks.list.mockRejectedValueOnce(new MyServersApiError("server_not_found", "Missing"));
    expect(await listManagedServerCampaigns(id, "owner")).toMatchObject({ ok: false, message: expect.stringContaining("unavailable") });
});
