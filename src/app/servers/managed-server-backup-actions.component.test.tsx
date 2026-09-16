import { beforeEach, expect, it, vi } from "vitest";
import { manageServerBackup } from "./managed-server-backup-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), submit: vi.fn(), status: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/hosting/my-servers")>(),
    requestMyServerBackupOperation: mocks.submit, getMyServerBackupStatus: mocks.status,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
const input = { action: "restore-backup", serverId: "11111111-1111-4111-8111-111111111111",
    backupId: "22222222-2222-4222-8222-222222222222", requestId: "33333333-3333-4333-8333-333333333333", expectedUpdatedAt: "2026-09-06T12:00:00.000Z" };
const updatedAt = "2026-09-06T13:00:00.000Z";
beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), getSession: async () => ({ data: { session: { access_token: "owner-token" } } }) } });
    mocks.status.mockResolvedValue({ serverId: input.serverId, updatedAt });
});
it("refreshes stale backup state and continues same UUID and backup selection", async () => {
    mocks.submit.mockRejectedValueOnce(new MyServersApiError("stale_interaction", "Stale"));
    mocks.submit.mockResolvedValueOnce({ outcome: "enqueued", jobId: "job", action: "restore" });
    expect(await manageServerBackup(input, "owner")).toMatchObject({ ok: true, jobId: "job" });
    const { requestId, ...operation } = input;
    expect(mocks.submit.mock.calls).toEqual([
        ["owner-token", operation, requestId],
        ["owner-token", { ...operation, expectedUpdatedAt: updatedAt }, requestId],
    ]);
    expect(mocks.status).toHaveBeenCalledWith("owner-token", input.serverId);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/servers/${input.serverId}`);
});
it("retains the request after a second stale rejection without looping", async () => {
    mocks.submit.mockRejectedValue(new MyServersApiError("stale_interaction", "Stale"));
    expect(await manageServerBackup(input, "owner")).toMatchObject({ ok: false, retrySameRequest: true });
    expect(mocks.submit).toHaveBeenCalledTimes(2); expect(mocks.status).toHaveBeenCalledOnce();
});
for (const error of [new Error("Network lost"), new MyServersApiError("operation_timeout", "Timeout"), new MyServersApiError("busy", "Busy")]) {
    it(`does not automatically retry ${error.message}`, async () => {
        mocks.submit.mockRejectedValue(error);
        expect(await manageServerBackup(input, "owner")).toMatchObject({ ok: false, retrySameRequest: true });
        expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.status).not.toHaveBeenCalled();
    });
}
it("retains request when fresh state is unavailable and never dispatches again", async () => {
    mocks.submit.mockRejectedValue(new MyServersApiError("stale_interaction", "Stale"));
    mocks.status.mockRejectedValue(new Error("Read failed"));
    expect(await manageServerBackup(input, "owner")).toMatchObject({ ok: false, retrySameRequest: true });
    expect(mocks.submit).toHaveBeenCalledOnce();
});
it("does not dispatch after authentication changes", async () => {
    expect(await manageServerBackup(input, "other-owner")).toMatchObject({ ok: false, retrySameRequest: true });
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
});
