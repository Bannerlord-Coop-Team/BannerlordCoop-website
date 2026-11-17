import { beforeEach, expect, it, vi } from "vitest";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { readServerBuildStatus } from "./server-build-actions";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({
    ...await original<typeof import("@/app/lib/hosting/my-servers")>(),
    getMyServerBuildStatus: mocks.status,
}));

const serverId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "verified-token" } } }) } });
});

it("reads update progress for the verified session, and hides every failure", async () => {
    mocks.status.mockResolvedValueOnce({ serverId, job: null });
    expect(await readServerBuildStatus(serverId)).toEqual({ serverId, job: null });
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith("verified-token", serverId);
    mocks.status.mockRejectedValueOnce(new MyServersApiError("operation_unavailable", "Older control plane"));
    expect(await readServerBuildStatus(serverId)).toBeNull();
    mocks.status.mockRejectedValueOnce(new Error("offline"));
    expect(await readServerBuildStatus(serverId)).toBeNull();
    mocks.auth.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) } });
    expect(await readServerBuildStatus(serverId)).toBeNull();
    expect(mocks.status).toHaveBeenCalledTimes(3);
});
