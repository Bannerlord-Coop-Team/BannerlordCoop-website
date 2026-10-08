import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act, Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type { ManagedServerConsole } from "@/app/components/servers/ManagedServerConsole";
import type { ManagedServerCommands } from "@/app/components/servers/ManagedServerCommands";
import type { ServerWorkspacePanel } from "@/app/components/servers/ServerManagementWorkspace";
import type { ServerSettingsPanel } from "@/app/components/servers/ServerSettingsPanel";
import type { ServerVisibilitySetting } from "@/app/components/servers/ServerVisibilitySetting";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ManagedServerFiles } from "@/app/components/servers/ManagedServerFiles";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";
import ServerPage, { generateMetadata } from "./page";
import { createTranslator } from "@/app/lib/localization/translator";
import { LiveServerBackupSetup } from "@/app/components/servers/LiveServerBackupSetup";
import { LiveServerVisibilitySetup } from "@/app/components/servers/LiveServerVisibilitySetup";

vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    // Selects the requested namespace while keeping deliberately distinct managed member labels.
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", namespace === "managed-server"
        ? { ...serverTestMessages[namespace], "member.missingName": "Missing member name", "member.missingEmail": "Missing member email" }
        : serverTestMessages[namespace]),
}));

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(), getSession: vi.fn(), liveServer: vi.fn(),
    liveAccess: vi.fn(), managedServers: vi.fn(), displayNames: vi.fn(),
    preview: vi.fn(), users: vi.fn(),
    backups: vi.fn(), backupStatus: vi.fn(), files: vi.fn(), requestBackup: vi.fn(), requestVisibility: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
    // Model Next's terminal redirect without rendering a denied page.
    redirect: (url: string) => { throw new Error(`redirect:${url}`); },
    useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/users", () => ({ listSupabaseUsers: mocks.users }));
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
    listAllMyServerBackups: mocks.backups,
    getMyServerBackupStatus: mocks.backupStatus,
    requestMyServerBackupOperation: mocks.requestBackup,
    requestServerVisibility: mocks.requestVisibility,
}));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({
    listAllMyServers: mocks.managedServers,
    getMyServerDeletionStatus: async () => null,
}));
vi.mock("@/app/lib/hosting/server-settings", () => ({ getServerDisplayNames: mocks.displayNames }));
vi.mock("@/app/lib/hosting/servers", () => ({ getServerForRole: mocks.preview }));

const liveId = "live-server";
const managedId = "abcdef12-1234-4123-8123-123456789abc";
const liveServer = { id: liveId, name: "Live", address: "203.0.113.10", nodeId: "node", provider: "External VPS", managedServerId: managedId };

// Verifies the unified page delivers each client namespace and localized metadata.
it("composes managed, shared, live and cheats dictionaries without changing page access", async () => {
    const result = await ServerPage({ params: Promise.resolve({ serverId: liveId }), searchParams: Promise.resolve({}) });
    expect(result.props.locale).toBe("en");
    expect(result.props.messages).toMatchObject(serverTestMessages);
    expect(await generateMetadata()).toEqual({ title: "Manage Server", description: "Manage a Bannerlord Coop server." });
});

// Invoke the real server page with a fixed requested identity.
function page(serverId = liveId) {
    return ServerPage({ params: Promise.resolve({ serverId }), searchParams: Promise.resolve({}) }).then(result => result.props.children);
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    mocks.liveServer.mockReturnValue(liveServer);
    mocks.liveAccess.mockReturnValue("operator");
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole: "manager" }]);
    mocks.displayNames.mockResolvedValue(new Map());
    mocks.users.mockResolvedValue({ users: [], truncated: false });
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

// Restores a remembered tab on the server so a reload does not flash the Console first.
it.each<[{ tab: string | string[]; accessError?: string }, string]>([
    [{ tab: "backups" }, "Backups"],
    [{ tab: ["save-config", "settings"] }, "Save & config"],
    [{ tab: "../../admin" }, "Console"],
    [{ tab: "backups", accessError: "Access could not be updated." }, "Settings"],
])("opens the live workspace tab remembered in %j", async (query, section) => {
    const tree = (await ServerPage({ params: Promise.resolve({ serverId: liveId }), searchParams: Promise.resolve(query) })).props.children;
    const workspace = await findServerElement(tree, "ServerManagementWorkspace" as string);
    expect((workspace!.props as { initialSection?: string }).initialSection).toBe(section);
});

it.each([["settings", "Settings"], ["unknown", undefined]] as const)("opens the managed workspace tab remembered as %s", async (tab, section) => {
    mocks.liveServer.mockReturnValue(null);
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole: "owner", displayName: "Managed", friendlyRegion: "Europe", operationState: "running", observedGameState: "running", releaseChannel: "stable", updatedAt: "2026-10-01T00:00:00.000Z" }]);
    const tree = (await ServerPage({ params: Promise.resolve({ serverId: managedId }), searchParams: Promise.resolve({ tab }) })).props.children;
    const workspace = await findServerElement(tree, "ServerManagementWorkspace" as string);
    expect((workspace!.props as { initialSection?: string }).initialSection).toBe(section);
});

it.each([
    ["running", "Paused for backup", "Backing up"],
    ["queued", "Running", "Backing up"],
    [null, "Running", "Running"],
] as const)("reports a %s backup job on a running server in the header status", async (jobState, gameState, lifecycle) => {
    mocks.liveServer.mockReturnValue(null);
    const updatedAt = "2026-10-01T00:00:00.000Z";
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole: "owner", displayName: "Managed", friendlyRegion: "Europe", operationState: "running", observedGameState: "running", releaseChannel: "stable", updatedAt }]);
    mocks.backupStatus.mockResolvedValue({ serverId: managedId, updatedAt, operationState: "running", observedGameState: "running",
        job: jobState === null ? null : { jobId: "44444444-4444-4444-8444-444444444444", action: "backup", state: jobState, progress: "Creating a safe restore point", createdAt: updatedAt, updatedAt } });
    const tree = (await ServerPage({ params: Promise.resolve({ serverId: managedId }), searchParams: Promise.resolve({}) })).props.children;
    const workspace = await findServerElement(tree, "ServerManagementWorkspace" as string);
    // The status sits in a Suspense boundary whose child reads the backup job; resolve that server component directly.
    const status = (workspace!.props as { status: ReactElement<{ children: ReactElement }> }).status.props.children;
    const html = renderToStaticMarkup(<>{await (status.type as (props: unknown) => Promise<ReactNode>)(status.props)}</>);
    expect(html).toContain(`Game state</dt><dd class="font-medium text-foreground">${gameState}`);
    expect(html).toContain(`Lifecycle</dt><dd class="font-medium text-foreground">${lifecycle}`);
    expect(mocks.backupStatus).toHaveBeenCalledWith("token", managedId);
});

// Resolve the page's server components, leaving client components for React to render.
function findServerElement(node: ReactNode, name: "LiveServerBackupSetup"): Promise<ReactElement<ComponentProps<typeof LiveServerBackupSetup>> | null>;
function findServerElement(node: ReactNode, name: "LiveServerVisibilitySetup"): Promise<ReactElement<ComponentProps<typeof LiveServerVisibilitySetup>> | null>;
function findServerElement(node: ReactNode, name: "ServerManagementWorkspace"): Promise<ReactElement<{ visibility: ReactElement<ComponentProps<typeof ServerVisibilitySetting>> }> | null>;
function findServerElement(node: ReactNode, name: "ServerSettingsPanel"): Promise<ReactElement<ComponentProps<typeof ServerSettingsPanel>> | null>;
function findServerElement(node: ReactNode, name: "ServerWorkspacePanel"): Promise<ReactElement<ComponentProps<typeof ServerWorkspacePanel>> | null>;
function findServerElement(node: ReactNode, name: "ManagedServerConsole"): Promise<ReactElement<ComponentProps<typeof ManagedServerConsole>> | null>;
function findServerElement(node: ReactNode, name: "ManagedServerCommands"): Promise<ReactElement<ComponentProps<typeof ManagedServerCommands>> | null>;
function findServerElement(node: ReactNode, name: string): Promise<ReactElement | null>;
async function findServerElement(node: ReactNode, name: string): Promise<ReactElement | null> {
    for (const child of Children.toArray(node)) {
        if (!isValidElement<{ children?: ReactNode }>(child)) continue;
        if (typeof child.type === "function") {
            if (child.type.name === name) return child;
            if (["LiveServerManagementPage", "ManagedServerManagementPage", "ManagedServerSections", "ManagedServerBackupsSection", "UnavailableFileWorkspaces"].includes(child.type.name)) {
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

// Exercises the unified page's member projection without altering assignment authority.
it("supplies localized missing identity labels while retaining real operator identity", async () => {
    mocks.liveAccess.mockReturnValue("owner");
    mocks.users.mockResolvedValue({ truncated: false, users: [
        { id: "owner", app_metadata: { live_console_owner_server_ids: [liveId] }, user_metadata: {} },
        { id: "operator", email: "real@example.com", app_metadata: { live_console_operator_server_ids: [liveId] }, user_metadata: { full_name: "Real {name}" } },
    ] });
    const access = await findServerElement(await page(), "LiveServerAccessManager");
    expect(access?.props).toMatchObject({
        owner: { id: "owner", displayName: "Missing member name", email: "Missing member email" },
        operators: [{ id: "operator", displayName: "Real {name}", email: "real@example.com" }],
    });
});

// Awaits real backup setup output before checking unavailable-access guidance and inert operations.
it.each(["mapping-required", "access-required", "lookup-failed"] as const)("explains %s without exposing backup operations", async (reason) => {
    mocks.managedServers.mockResolvedValue([]);
    if (reason === "mapping-required") mocks.liveServer.mockReturnValue({ ...liveServer, managedServerId: undefined });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        if (reason === "lookup-failed") mocks.managedServers.mockRejectedValue(new Error("Unavailable"));
        const tree = await page();
        const setup = await findServerElement(tree, "LiveServerBackupSetup");
        expect(setup?.props).toEqual({ reason, serverId: liveId });
        const html = renderToStaticMarkup(<TestLocalization>{await LiveServerBackupSetup(setup!.props)} </TestLocalization>);
        expect(html).toContain(reason === "lookup-failed" ? "Reload backup access" : "View managed servers and setup options");
        if (reason === "lookup-failed") {
            // A same-page fragment link would not reload; GET must request fresh access.
            expect(html).toContain(`action="/servers/${liveId}#server-backups" method="get"`);
        } else {
            expect(html).not.toContain("<button");
        }
        expect(html).not.toContain("Create backup");
        expect(html).not.toContain("Restore save");
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
    expect(renderToStaticMarkup(<TestLocalization>{files} </TestLocalization>)).toContain("require owner or manager access");
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
        expect(files?.props).toMatchObject({ backups: [], loadError: expect.stringContaining("It will reload automatically") });
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
        await act(async () => root.render(<TestLocalization>{<ManagedServerPollingProvider>{files}</ManagedServerPollingProvider>} </TestLocalization>));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(container.textContent).toContain("Manual");
        const button = Array.from(container.querySelectorAll("button")).find(button => button.textContent === label)!;
        expect(button.disabled).toBe(false);
        await act(async () => button.click());
        expect(mocks.requestBackup).toHaveBeenCalledExactlyOnceWith("token", {
            serverId: managedId, action, expectedUpdatedAt: updatedAt,
            ...(action === "restore-backup" ? { backupId } : {}),
        }, expect.stringMatching(/^[0-9a-f-]{36}$/));
        // Both operations interrupt this running server, so each is confirmed first.
        expect(confirm).toHaveBeenCalledOnce();
        expect(mocks.refresh).toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
        vi.useRealTimers();
    }
});

// Awaits real visibility setup output without changing mapped identity or authorization expectations.
it.each(["mapping-required", "access-required", "lookup-failed"] as const)("links live visibility to actionable %s guidance without granting access", async reason => {
    // An unrelated owned server must never substitute for the configured identity.
    mocks.managedServers.mockResolvedValue([{ serverId: "unrelated", accessRole: "owner" }]);
    if (reason === "mapping-required") mocks.liveServer.mockReturnValue({ ...liveServer, managedServerId: undefined });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        if (reason === "lookup-failed") mocks.managedServers.mockRejectedValue(new Error("Unavailable"));
        const tree = await page();
        const workspace = await findServerElement(tree, "ServerManagementWorkspace");
        expect(renderToStaticMarkup(<TestLocalization>{workspace!.props.visibility} </TestLocalization>)).toContain('href="#server-visibility"');
        const setup = await findServerElement(tree, "LiveServerVisibilitySetup");
        expect(setup?.props).toEqual({ reason, serverId: liveId });
        const html = renderToStaticMarkup(<TestLocalization>{await LiveServerVisibilitySetup(setup!.props)} </TestLocalization>);
        expect(html).toContain('id="server-visibility"');
        if (reason === "lookup-failed") {
            expect(html).toContain(`action="/servers/${liveId}#server-visibility" method="get"`);
            expect(html).not.toContain("setup options");
        } else {
            expect(html).toContain("managed owner");
            expect(html).toContain("does not publish");
            expect(html).not.toContain("<button");
        }
        const settings = await findServerElement(tree, "ServerSettingsPanel");
        expect(settings!.props.visibilityAccess).toBeUndefined();
        expect(settings!.props.visibility).toBeUndefined();
        expect(mocks.requestVisibility).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
});

it.each(["owner", "manager", "admin", "support"])("uses mapped managed %s authority in both visibility controls", async accessRole => {
    mocks.liveAccess.mockReturnValue("owner");
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole, visibility: "public", updatedAt: "2026-09-26T12:00:00.000Z" }]);
    const tree = await page();
    const workspace = await findServerElement(tree, "ServerManagementWorkspace");
    const header = workspace!.props.visibility;
    const settings = await findServerElement(tree, "ServerSettingsPanel");
    expect(header.props).toEqual({ serverId: managedId, visibility: "public", accessRole, expectedUpdatedAt: "2026-09-26T12:00:00.000Z" });
    expect(settings!.props.visibility).toBe("public");
    expect(settings!.props.visibilityAccess).toEqual({ serverId: managedId, expectedUpdatedAt: "2026-09-26T12:00:00.000Z", canEdit: accessRole === "owner" });
    expect(await findServerElement(tree, "LiveServerVisibilitySetup")).toBeNull();
});

it.each([liveId, managedId])("supplies current maintenance preferences for managed identity on %s", async requestedId => {
    mocks.liveAccess.mockReturnValue("owner");
    if (requestedId === managedId) mocks.liveServer.mockReturnValue(null);
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole: "owner", displayName: "Owned server",
        friendlyRegion: "us-west", observedGameState: "stopped", operationState: "drifted", releaseChannel: "stable", visibility: "private",
        maintenanceSlot: "18:00-19:00", timezone: "America/Chicago", updatedAt: "2026-10-01T00:00:00.000Z" }]);
    const settings = await findServerElement(await page(requestedId), "ServerSettingsPanel");
    expect(settings!.props.settingsAccess).toEqual({ serverId: managedId, expectedUpdatedAt: "2026-10-01T00:00:00.000Z",
        maintenanceSlot: "18:00-19:00", timezone: "America/Chicago", canEdit: true });
    expect(settings!.props.name).toBe("Owned server");
    expect(settings!.props.renameServerId).toBeUndefined();
});

it("keeps preview visibility non-operational without live onboarding", async () => {
    mocks.liveServer.mockReturnValue(null);
    mocks.managedServers.mockResolvedValue([]);
    mocks.preview.mockReturnValue({ name: "Demo", assignedAccount: {} });
    const tree = await page("preview");
    expect(await findServerElement(tree, "LiveServerVisibilitySetup")).toBeNull();
    const settings = await findServerElement(tree, "ServerSettingsPanel");
    expect(settings!.props.visibilityAccess).toBeUndefined();
    expect(settings!.props.visibility).toBeUndefined();
});

it("updates the mapped identity through both controls and waits for authoritative refresh", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token", user: { id: "user" } } } });
    const updatedAt = "2026-09-26T12:00:00.000Z";
    const nextUpdatedAt = "2026-09-26T12:01:00.000Z";
    mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole: "owner", visibility: "private", updatedAt }]);
    mocks.requestVisibility.mockResolvedValue({ outcome: "updated" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div");
    const root = createRoot(container);
    async function renderVisibility() {
        const tree = await page();
        const workspace = await findServerElement(tree, "ServerManagementWorkspace");
        const settings = await findServerElement(tree, "ServerSettingsPanel");
        await act(async () => root.render(<TestLocalization>{<>{workspace!.props.visibility}{settings}</>} </TestLocalization>));
    }
    try {
        await renderVisibility();
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
        expect(mocks.requestVisibility).toHaveBeenLastCalledWith("token", { action: "set-server-visibility", serverId: managedId, visibility: "public", expectedUpdatedAt: updatedAt }, expect.any(String));
        expect(mocks.refresh).toHaveBeenCalledOnce();
        // An acknowledged receipt does not prove the current state (it may be a replay).
        expect(container.querySelector("summary")!.textContent).not.toContain("Public");
        expect(container.querySelector<HTMLInputElement>('input[value="private"]')!.checked).toBe(true);
        mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole: "owner", visibility: "public", updatedAt: nextUpdatedAt }]);
        await renderVisibility();
        expect(container.querySelector("summary")!.textContent).toContain("Public");
        expect(container.querySelector<HTMLInputElement>('input[value="public"]')!.checked).toBe(true);
        await act(async () => container.querySelector<HTMLInputElement>('input[value="private"]')!.click());
        await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        expect(mocks.requestVisibility).toHaveBeenLastCalledWith("token", { action: "set-server-visibility", serverId: managedId, visibility: "private", expectedUpdatedAt: nextUpdatedAt }, expect.any(String));
        expect(mocks.refresh).toHaveBeenCalledTimes(2);
        expect(container.querySelector("summary")!.textContent).toContain("Public");
        mocks.managedServers.mockResolvedValue([{ serverId: managedId, accessRole: "owner", visibility: "private", updatedAt: "2026-09-26T12:02:00.000Z" }]);
        await renderVisibility();
        expect(container.querySelector("summary")!.textContent).toContain("Private");
        expect(container.querySelector<HTMLInputElement>('input[value="private"]')!.checked).toBe(true);
        expect(confirm).toHaveBeenCalledOnce();
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
    }
});

// Console merge matrix: managed owners/managers get output; read-only roles and existing live consoles do not.
it.each(["owner", "manager", "support", "admin"])("preserves managed console access for %s in the workspace", async (accessRole) => {
    mocks.liveServer.mockReturnValue(null);
    mocks.managedServers.mockResolvedValue([{
        serverId: managedId, accessRole, observedGameState: "running", operationState: "idle", friendlyRegion: "europe",
    }]);
    const tree = await page(managedId);
    const workspace = await findServerElement(tree, "ServerWorkspacePanel");
    expect(workspace?.props.section).toBe("Console");
    const operator = accessRole === "owner" || accessRole === "manager";
    const commands = await findServerElement(workspace, "ManagedServerCommands");
    expect(commands?.props.server.serverId).toBe(operator ? managedId : undefined);
});

it("does not duplicate the existing live console with managed output", async () => {
    const tree = await page();
    expect(await findServerElement(tree, "LiveServerConsole")).not.toBeNull();
    expect(await findServerElement(tree, "ManagedServerConsole")).toBeNull();
    expect(await findServerElement(tree, "ManagedServerCommands")).toBeNull();
});

it("places managed password configuration in Settings rather than the Console workspace", async () => {
    mocks.liveServer.mockReturnValue(null);
    mocks.managedServers.mockResolvedValue([{
        serverId: managedId, accessRole: "owner", observedGameState: "running", operationState: "running", friendlyRegion: "europe",
    }]);
    const tree = await page(managedId);
    const sections = (await findServerElement(tree, "ManagedServerSections"))!;
    const renderSections = sections.type as (props: unknown) => ReactElement<{ children: ReactNode }>;
    const panels = Children.toArray(renderSections(sections.props).props.children);
    const settings = panels.find(child => isValidElement<{ section?: string }>(child) && child.props.section === "Settings");
    const consolePanel = panels.find(child => isValidElement<{ section?: string }>(child) && child.props.section === "Console");
    expect(await findServerElement(settings, "ManagedServerPassword")).toMatchObject({ props: { serverId: managedId, accessRole: "owner" } });
    expect(await findServerElement(consolePanel, "ManagedServerPassword")).toBeNull();
});
