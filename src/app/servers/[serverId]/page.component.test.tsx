import { act, Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ManagedServerFiles } from "@/app/components/servers/ManagedServerFiles";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";
import ServerPage from "./page";

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(), getSession: vi.fn(), liveServer: vi.fn(),
    liveAccess: vi.fn(), managedServers: vi.fn(), displayNames: vi.fn(),
    preview: vi.fn(),
    backups: vi.fn(), backupStatus: vi.fn(), files: vi.fn(), requestBackup: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
    // Model Next's terminal redirect without rendering a denied page.
    redirect: (url: string) => { throw new Error(`redirect:${url}`); },
    useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/users", () => ({ listSupabaseUsers: async () => ({ users: [], truncated: false }) }));
vi.mock("@/app/lib/hosting/server-files", () => ({ getMyServerFiles: mocks.files }));
vi.mock("@/app/components/servers/ManagedServerTransfers", () => ({ ManagedServerTransfers: () => null }));
vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser, getSession: mocks.getSession } }),
}));
vi.mock("@/app/lib/console/servers", () => ({ getLiveConsoleServer: mocks.liveServer, getConsoleGatewayUrl: () => null }));
vi.mock("@/app/lib/auth/access", () => ({
    getLiveConsoleAccessLevel: mocks.liveAccess, getMemberRole: () => "Admin", hasHostedServerAccess: () => true,
}));
vi.mock("@/app/lib/hosting/my-servers", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/hosting/my-servers")>(),
    listAllMyServers: mocks.managedServers,
    listAllMyServerBackups: mocks.backups,
    getMyServerBackupStatus: mocks.backupStatus,
    requestMyServerBackupOperation: mocks.requestBackup,
}));
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

// Resolve the page's server components, leaving client components for React to render.
async function findServerElement(node: ReactNode, name: string): Promise<ReactElement | null> {
    for (const child of Children.toArray(node)) {
        if (!isValidElement<{ children?: ReactNode }>(child)) continue;
        if (typeof child.type === "function") {
            if (child.type.name === name) return child;
            if (["LiveServerManagementPage", "ManagedServerSections", "ManagedServerBackupsSection", "UnavailableFileWorkspaces"].includes(child.type.name)) {
                const component = child.type as (props: unknown) => ReactNode | Promise<ReactNode>;
                const found = await findServerElement(await component(child.props), name);
                if (found) return found;
                continue;
            }
        }
        const found = await findServerElement(child.props.children, name);
        if (found) return found;
    }
    return null;
}

it.each(["mapping-required", "access-required", "lookup-failed"] as const)("explains %s without exposing backup operations", async (reason) => {
    mocks.managedServers.mockResolvedValue([]);
    if (reason === "mapping-required") mocks.liveServer.mockReturnValue({ ...liveServer, managedServerId: undefined });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        if (reason === "lookup-failed") mocks.managedServers.mockRejectedValue(new Error("Unavailable"));
        const tree = await page();
        const setup = await findServerElement(tree, "LiveServerBackupSetup");
        expect(setup?.props).toEqual({ reason, serverId: liveId });
        const html = renderToStaticMarkup(setup);
        expect(html).toContain(reason === "lookup-failed" ? "Reload backup access" : "View managed servers and setup options");
        expect(html).not.toContain("<button");
        expect(await findServerElement(tree, "ManagedServerFiles")).toBeNull();
        expect(mocks.backups).not.toHaveBeenCalled();
        expect(mocks.backupStatus).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
});

it("keeps fictional preview backup panels non-operational", async () => {
    mocks.liveServer.mockReturnValue(null);
    mocks.managedServers.mockResolvedValue([]);
    mocks.preview.mockReturnValue({ name: "Demo", assignedAccount: {} });
    const tree = await page("preview");
    expect(await findServerElement(tree, "LiveServerBackupSetup")).toBeNull();
    expect(await findServerElement(tree, "ManagedServerFiles")).toBeNull();
    expect(await findServerElement(tree, "UnavailableServerPanel")).not.toBeNull();
});

it.each(["admin", "support"])("does not load private backup data for mapped read-only %s access", async (accessRole) => {
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole }]);
    const files = await findServerElement(await page(), "ManagedServerFiles");
    expect(files).not.toBeNull();
    expect(renderToStaticMarkup(files)).toContain("require owner or manager access");
    expect(mocks.backups).not.toHaveBeenCalled();
    expect(mocks.backupStatus).not.toHaveBeenCalled();
    expect(mocks.files).not.toHaveBeenCalled();
});

it("keeps managed backup load failures distinct from missing onboarding", async () => {
    mocks.backups.mockRejectedValue(new Error("History unavailable"));
    mocks.backupStatus.mockResolvedValue(null);
    mocks.files.mockResolvedValue(null);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        const tree = await page();
        const files = await findServerElement(tree, "ManagedServerFiles");
        expect(files?.props).toMatchObject({ backups: [], loadError: expect.stringContaining("Refresh before submitting") });
        expect(await findServerElement(tree, "LiveServerBackupSetup")).toBeNull();
    } finally { error.mockRestore(); }
});

it.each([
    ["owner", "Create backup", "create-backup"],
    ["manager", "Restore save", "restore-backup"],
])("connects mapped %s backup history and %s to the existing authenticated operation", async (accessRole, label, action) => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    sessionStorage.clear();
    const updatedAt = "2026-09-22T10:00:00.000Z";
    const backupId = "33333333-3333-4333-8333-333333333333";
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole, updatedAt, displayName: "Mapped campaign", operationState: "running", observedGameState: "running" }]);
    mocks.backups.mockResolvedValue([{ backupId, backupType: "manual", byteSize: 1024, createdAt: updatedAt, retentionExpiresAt: "2026-10-22T10:00:00.000Z", restoreState: "available", restoredAt: null, canRestore: true }]);
    mocks.backupStatus.mockResolvedValue({ serverId: managedId, updatedAt, operationState: "running", observedGameState: "running", job: null });
    mocks.files.mockResolvedValue(null);
    mocks.requestBackup.mockResolvedValue({ outcome: "accepted", jobId: "44444444-4444-4444-8444-444444444444" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        const files = await findServerElement(await page(), "ManagedServerFiles");
        expect(files?.type).toBe(ManagedServerFiles);
        expect(mocks.backups).toHaveBeenCalledExactlyOnceWith("token", managedId);
        expect(mocks.backupStatus).toHaveBeenCalledExactlyOnceWith("token", managedId);
        await act(async () => root.render(<ManagedServerPollingProvider>{files}</ManagedServerPollingProvider>));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(container.textContent).toContain("Manual");
        const button = Array.from(container.querySelectorAll("button")).find(button => button.textContent === label)!;
        expect(button.disabled).toBe(false);
        await act(async () => button.click());
        expect(mocks.requestBackup).toHaveBeenCalledExactlyOnceWith("token", {
            serverId: managedId, action, expectedUpdatedAt: updatedAt,
            ...(action === "restore-backup" ? { backupId } : {}),
        }, expect.stringMatching(/^[0-9a-f-]{36}$/));
        expect(confirm).toHaveBeenCalledTimes(action === "restore-backup" ? 1 : 0);
        expect(mocks.refresh).toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
        vi.useRealTimers();
    }
});
