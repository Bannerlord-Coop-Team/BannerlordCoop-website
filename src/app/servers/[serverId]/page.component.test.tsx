import { beforeEach, expect, it, vi } from "vitest";
import ServerPage from "./page";

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(), getSession: vi.fn(), liveServer: vi.fn(),
    liveAccess: vi.fn(), managedServers: vi.fn(), displayNames: vi.fn(),
    preview: vi.fn(),
}));
vi.mock("next/navigation", () => ({
    // Model Next's terminal redirect without rendering a denied page.
    redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser, getSession: mocks.getSession } }),
}));
vi.mock("@/app/lib/console/servers", () => ({ getLiveConsoleServer: mocks.liveServer, getConsoleGatewayUrl: () => null }));
vi.mock("@/app/lib/auth/access", () => ({
    getLiveConsoleAccessLevel: mocks.liveAccess, getMemberRole: () => "Admin", hasHostedServerAccess: () => true,
}));
vi.mock("@/app/lib/hosting/my-servers", () => ({ listAllMyServers: mocks.managedServers }));
vi.mock("@/app/lib/hosting/server-settings", () => ({ getServerDisplayNames: mocks.displayNames }));
vi.mock("@/app/lib/hosting/servers", () => ({ getServerForRole: mocks.preview }));

const liveId = "live-server";
const managedId = "abcdef12-1234-4123-8123-123456789abc";
const liveServer = { id: liveId, name: "Live", address: "203.0.113.10", nodeId: "node", provider: "External VPS", managedServerId: managedId };

// Invoke the real server page with a fixed requested identity.
function page(serverId = liveId) {
    return ServerPage({ params: Promise.resolve({ serverId }), searchParams: Promise.resolve({}) });
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    mocks.liveServer.mockReturnValue(liveServer);
    mocks.liveAccess.mockReturnValue("operator");
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole: "manager" }]);
    mocks.displayNames.mockResolvedValue(new Map());
});

it("redirects anonymous visitors to login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(page()).rejects.toThrow("redirect:/login?next=/servers/live-server");
    expect(mocks.liveServer).not.toHaveBeenCalled();
    expect(mocks.managedServers).not.toHaveBeenCalled();
});

it("redirects a verified user without a session token before loading server data", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(page()).rejects.toThrow("redirect:/login?next=/servers/live-server");
    expect(mocks.liveServer).not.toHaveBeenCalled();
    expect(mocks.managedServers).not.toHaveBeenCalled();
    expect(mocks.displayNames).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
});

it("denies known live servers before managed or preview fallthrough, even for a same-ID managed assignment", async () => {
    mocks.liveAccess.mockReturnValue(null);
    mocks.managedServers.mockResolvedValue([{ serverId: liveId, accessRole: "owner" }]);
    await expect(page()).rejects.toThrow("redirect:/servers");
    expect(mocks.managedServers).not.toHaveBeenCalled();
    expect(mocks.displayNames).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
});

it.each(["owner", "operator", "admin"])("resolves one managed identity for live %s access and all managed controls", async (accessLevel) => {
    mocks.liveAccess.mockReturnValue(accessLevel);
    const result = await page();
    expect(mocks.managedServers).toHaveBeenCalledExactlyOnceWith("token");
    expect(result.props.logDownload).toEqual({ serverId: managedId, userId: "user" });
    expect(result.props.server.id).toBe(liveId);
    expect(result.props.managedServer).toEqual({ serverId: managedId, accessRole: "manager" });
});

it.each(["missing", "support", "admin"])("keeps mapped logs unavailable for %s managed access without falling back", async (accessRole) => {
    mocks.managedServers.mockResolvedValue([
        { serverId: liveId, accessRole: "owner" },
        ...(accessRole === "missing" ? [] : [{ serverId: managedId, accessRole }]),
    ]);
    const result = await page();
    expect(result.props.logDownload).toBeUndefined();
    expect(result.props.managedServer).toEqual(accessRole === "missing" ? null : { serverId: managedId, accessRole });
});

it("preserves same-ID downloads when no explicit mapping exists", async () => {
    mocks.liveServer.mockReturnValue({ ...liveServer, managedServerId: undefined });
    mocks.managedServers.mockResolvedValue([{ serverId: liveId, accessRole: "owner" }]);
    expect((await page()).props.logDownload).toEqual({ serverId: liveId, userId: "user" });
});

it("keeps live access but no download when the managed lookup is unavailable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        mocks.managedServers.mockRejectedValue(new Error("Unavailable"));
        expect((await page()).props.logDownload).toBeUndefined();
    } finally { error.mockRestore(); }
});

it("preserves managed-only pages without requiring live authorization", async () => {
    mocks.liveServer.mockReturnValue(null);
    const result = await page(managedId);
    expect(result.props.server.serverId).toBe(managedId);
    expect(mocks.liveAccess).not.toHaveBeenCalled();
});
