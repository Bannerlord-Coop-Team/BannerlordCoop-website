import { act, Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type { ManagedServerConsole } from "@/app/components/servers/ManagedServerConsole";
import type { ServerWorkspacePanel } from "@/app/components/servers/ServerManagementWorkspace";
import type { ServerSettingsPanel } from "@/app/components/servers/ServerSettingsPanel";
import type { ServerVisibilitySetting } from "@/app/components/servers/ServerVisibilitySetting";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ManagedServerFiles } from "@/app/components/servers/ManagedServerFiles";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";
import ServerPage from "./page";

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(), getSession: vi.fn(),
    managedServers: vi.fn(),
    preview: vi.fn(), hostedAccess: vi.fn(),
    backups: vi.fn(), backupStatus: vi.fn(), files: vi.fn(), requestBackup: vi.fn(), requestVisibility: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
    // Model Next's terminal redirect without rendering a denied page.
    redirect: (url: string) => { throw new Error(`redirect:${url}`); },
    useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/hosting/server-files", () => ({ getMyServerFiles: mocks.files }));
vi.mock("@/app/components/servers/ManagedServerTransfers", () => ({ ManagedServerTransfers: () => null }));
vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser, getSession: mocks.getSession } }),
}));
vi.mock("@/app/lib/auth/access", () => ({
    getMemberRole: () => "Admin", hasHostedServerAccess: mocks.hostedAccess,
}));
vi.mock("@/app/lib/hosting/my-servers", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/hosting/my-servers")>(),
    listAllMyServers: mocks.managedServers,
    listAllMyServerBackups: mocks.backups,
    getMyServerBackupStatus: mocks.backupStatus,
    requestMyServerBackupOperation: mocks.requestBackup,
    requestServerVisibility: mocks.requestVisibility,
}));
vi.mock("@/app/lib/hosting/servers", () => ({ getServerForRole: mocks.preview }));

const managedId = "abcdef12-1234-4123-8123-123456789abc";
const managedServer = { serverId: managedId, displayName: "Campaign", observedGameState: "running", operationState: "running", friendlyRegion: "europe", releaseChannel: "stable" };

// Invoke the real server page with a fixed requested identity.
function page(serverId = managedId) {
    return ServerPage({ params: Promise.resolve({ serverId }) });
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    mocks.hostedAccess.mockReturnValue(true);
    mocks.managedServers.mockResolvedValue([{ ...managedServer, accessRole: "manager", displayName: "Campaign", observedGameState: "running", operationState: "running", friendlyRegion: "europe", releaseChannel: "stable" }]);
});

// Access matrix: anonymous/missing session -> login; unknown or retired identity -> discovery;
// exact authorized managed identity -> managed capabilities; previews remain inert.
it("redirects anonymous visitors to login before requesting private inventory", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(page()).rejects.toThrow(`redirect:/login?next=/servers/${managedId}`);
    expect(mocks.managedServers).not.toHaveBeenCalled();
});

it("redirects a verified user without a session token before requesting private inventory", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(page()).rejects.toThrow(`redirect:/login?next=/servers/${managedId}`);
    expect(mocks.managedServers).not.toHaveBeenCalled();
});

it.each([true, false])("returns the retired server to discovery with hosted access %s without selecting another assignment", async hostedAccess => {
    mocks.hostedAccess.mockReturnValue(hostedAccess);
    await expect(page("bannerlord-live-15-204-120-17")).rejects.toThrow("redirect:/servers");
    expect(mocks.managedServers).toHaveBeenCalledExactlyOnceWith("token");
    expect(mocks.backups).not.toHaveBeenCalled();
    expect(mocks.files).not.toHaveBeenCalled();
});

it("does not substitute another managed assignment for an unavailable requested UUID", async () => {
    await expect(page("bbbbbbbb-1234-4123-8123-123456789abc")).rejects.toThrow("redirect:/servers");
    expect(mocks.backups).not.toHaveBeenCalled();
    expect(mocks.files).not.toHaveBeenCalled();
});

it("returns to discovery when managed inventory is unavailable instead of using external controls", async () => {
    mocks.managedServers.mockRejectedValue(new Error("Inventory unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        await expect(page()).rejects.toThrow("redirect:/servers");
        expect(mocks.backups).not.toHaveBeenCalled();
        expect(mocks.files).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
});

// Resolve the page's server components, leaving client components for React to render.
function findServerElement(node: ReactNode, name: "ServerManagementWorkspace"): Promise<ReactElement<{ visibility: ReactElement<ComponentProps<typeof ServerVisibilitySetting>> }> | null>;
function findServerElement(node: ReactNode, name: "ServerSettingsPanel"): Promise<ReactElement<ComponentProps<typeof ServerSettingsPanel>> | null>;
function findServerElement(node: ReactNode, name: "ServerWorkspacePanel"): Promise<ReactElement<ComponentProps<typeof ServerWorkspacePanel>> | null>;
function findServerElement(node: ReactNode, name: "ManagedServerConsole"): Promise<ReactElement<ComponentProps<typeof ManagedServerConsole>> | null>;
function findServerElement(node: ReactNode, name: string): Promise<ReactElement | null>;
async function findServerElement(node: ReactNode, name: string): Promise<ReactElement | null> {
    for (const child of Children.toArray(node)) {
        if (!isValidElement<{ children?: ReactNode }>(child)) continue;
        if (typeof child.type === "function") {
            if (child.type.name === name) return child;
            if (["ManagedServerManagementPage", "ManagedServerSections", "ManagedServerBackupsSection", "UnavailableFileWorkspaces"].includes(child.type.name)) {
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

it("keeps fictional preview backup panels non-operational", async () => {
    mocks.managedServers.mockResolvedValue([]);
    mocks.preview.mockReturnValue({ name: "Demo", assignedAccount: {} });
    const tree = await page("preview");
    expect(await findServerElement(tree, "ManagedServerFiles")).toBeNull();
    expect(await findServerElement(tree, "UnavailableServerPanel")).not.toBeNull();
});

it.each(["admin", "support"])("does not load private backup data for managed read-only %s access", async (accessRole) => {
    mocks.managedServers.mockResolvedValue([{ ...managedServer, accessRole }]);
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
    } finally { error.mockRestore(); }
});

it.each([
    ["owner", "Create backup", "create-backup"],
    ["manager", "Restore save", "restore-backup"],
])("connects managed %s backup history and %s to the existing authenticated operation", async (accessRole, label, action) => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    sessionStorage.clear();
    const updatedAt = "2026-09-22T10:00:00.000Z";
    const backupId = "33333333-3333-4333-8333-333333333333";
    mocks.managedServers.mockResolvedValue([{ ...managedServer, accessRole, updatedAt, displayName: "Managed campaign", operationState: "running", observedGameState: "running" }]);
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

it.each(["owner", "manager", "admin", "support"])("uses managed %s authority in both visibility controls", async accessRole => {
    mocks.managedServers.mockResolvedValue([{ ...managedServer, accessRole, visibility: "public", updatedAt: "2026-09-26T12:00:00.000Z" }]);
    const tree = await page();
    const workspace = await findServerElement(tree, "ServerManagementWorkspace");
    const header = workspace!.props.visibility;
    const settings = await findServerElement(tree, "ServerSettingsPanel");
    expect(header.props).toEqual({ serverId: managedId, visibility: "public", accessRole, expectedUpdatedAt: "2026-09-26T12:00:00.000Z" });
    expect(settings!.props.visibility).toBe("public");
    expect(settings!.props.visibilityAccess).toEqual({ serverId: managedId, expectedUpdatedAt: "2026-09-26T12:00:00.000Z", canEdit: accessRole === "owner" });
});

it("keeps preview visibility non-operational without operational settings", async () => {
    mocks.managedServers.mockResolvedValue([]);
    mocks.preview.mockReturnValue({ name: "Demo", assignedAccount: {} });
    const tree = await page("preview");
    const settings = await findServerElement(tree, "ServerSettingsPanel");
    expect(settings!.props.visibilityAccess).toBeUndefined();
    expect(settings!.props.visibility).toBeUndefined();
});

it("updates the managed identity through both controls and waits for authoritative refresh", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token", user: { id: "user" } } } });
    const updatedAt = "2026-09-26T12:00:00.000Z";
    const nextUpdatedAt = "2026-09-26T12:01:00.000Z";
    mocks.managedServers.mockResolvedValue([{ ...managedServer, accessRole: "owner", visibility: "private", updatedAt }]);
    mocks.requestVisibility.mockResolvedValue({ outcome: "updated" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div");
    const root = createRoot(container);
    // Renders both visibility controls from the latest authenticated server record.
    async function renderVisibility() {
        const tree = await page();
        const workspace = await findServerElement(tree, "ServerManagementWorkspace");
        const settings = await findServerElement(tree, "ServerSettingsPanel");
        await act(async () => root.render(<>{workspace!.props.visibility}{settings}</>));
    }
    try {
        await renderVisibility();
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
        expect(mocks.requestVisibility).toHaveBeenLastCalledWith("token", { action: "set-server-visibility", serverId: managedId, visibility: "public", expectedUpdatedAt: updatedAt }, expect.any(String));
        expect(mocks.refresh).toHaveBeenCalledOnce();
        // An acknowledged receipt does not prove the current state (it may be a replay).
        expect(container.querySelector("summary")!.textContent).toContain("Private");
        expect(container.querySelector<HTMLInputElement>('input[value="private"]')!.checked).toBe(true);
        mocks.managedServers.mockResolvedValue([{ ...managedServer, accessRole: "owner", visibility: "public", updatedAt: nextUpdatedAt }]);
        await renderVisibility();
        expect(container.querySelector("summary")!.textContent).toContain("Public");
        expect(container.querySelector<HTMLInputElement>('input[value="public"]')!.checked).toBe(true);
        await act(async () => container.querySelector<HTMLInputElement>('input[value="private"]')!.click());
        await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        expect(mocks.requestVisibility).toHaveBeenLastCalledWith("token", { action: "set-server-visibility", serverId: managedId, visibility: "private", expectedUpdatedAt: nextUpdatedAt }, expect.any(String));
        expect(mocks.refresh).toHaveBeenCalledTimes(2);
        expect(container.querySelector("summary")!.textContent).toContain("Public");
        mocks.managedServers.mockResolvedValue([{ ...managedServer, accessRole: "owner", visibility: "private", updatedAt: "2026-09-26T12:02:00.000Z" }]);
        await renderVisibility();
        expect(container.querySelector("summary")!.textContent).toContain("Private");
        expect(container.querySelector<HTMLInputElement>('input[value="private"]')!.checked).toBe(true);
        expect(confirm).toHaveBeenCalledOnce();
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
    }
});

it.each(["owner", "manager", "support", "admin"])("preserves managed console access for %s without a preview hosting role", async (accessRole) => {
    mocks.hostedAccess.mockReturnValue(false);
    mocks.managedServers.mockResolvedValue([{
        ...managedServer, accessRole, observedGameState: "running", operationState: "idle", friendlyRegion: "europe",
    }]);
    const tree = await page(managedId);
    const workspace = await findServerElement(tree, "ServerWorkspacePanel");
    expect(workspace?.props.section).toBe("Console");
    const consolePanel = await findServerElement(workspace, "ManagedServerConsole");
    expect(consolePanel?.props.serverId).toBe(accessRole === "owner" || accessRole === "manager" ? managedId : undefined);
});
