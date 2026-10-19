import { beforeEach, expect, it, vi } from "vitest";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { readManagedServerMoveStatus } from "./managed-server-move-actions";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({ getMyServerMoveStatus: mocks.read }));

const serverId = "11111111-1111-4111-8111-111111111111";
const move = { state: "moving", scheduledAt: null, startedAt: "2026-10-19T03:01:00.000Z", completedAt: null, step: "restoring", address: null, stayedOnOriginal: null };

function session(userId = "owner", sessionUserId = userId) {
    return { auth: { getUser: async () => ({ data: { user: { id: userId } } }),
        getSession: async () => ({ data: { session: { user: { id: sessionUserId }, access_token: "verified-token" } } }) } };
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(session());
    mocks.read.mockResolvedValue(move);
});

it("reads the move status with the verified session and a bounded wait", async () => {
    expect(await readManagedServerMoveStatus(serverId)).toEqual({ ok: true, move });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("verified-token", serverId, expect.any(AbortSignal));
    mocks.read.mockResolvedValueOnce(null);
    expect(await readManagedServerMoveStatus(serverId)).toEqual({ ok: true, move: null });
});

it("reports a quiet failure, not an empty status, when the read fails", async () => {
    for (const error of [
        new MyServersApiError("invalid_request", "Unknown operation"),
        new MyServersApiError("invalid_response", "Invalid move status.", true),
        new MyServersApiError("server_api_unavailable", "Unreachable", true),
        new Error("boom"),
    ]) {
        mocks.read.mockRejectedValueOnce(error);
        expect(await readManagedServerMoveStatus(serverId)).toEqual({ ok: false });
    }
});

it("fails quietly without a matching session, or when an impersonation can no longer be resolved", async () => {
    mocks.auth.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) } });
    expect(await readManagedServerMoveStatus(serverId)).toEqual({ ok: false });
    mocks.auth.mockResolvedValueOnce(session("owner", "someone-else"));
    expect(await readManagedServerMoveStatus(serverId)).toEqual({ ok: false });
    // An expired impersonation redirects from the client factory; a background read must not navigate.
    mocks.auth.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    expect(await readManagedServerMoveStatus(serverId)).toEqual({ ok: false });
    expect(mocks.read).not.toHaveBeenCalled();
});

it("rejects malformed server IDs before authenticating", async () => {
    for (const value of [undefined, 42, "server", `${serverId} `, "11111111-1111-9111-8111-111111111111"]) {
        expect(await readManagedServerMoveStatus(value)).toEqual({ ok: false });
    }
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
});
