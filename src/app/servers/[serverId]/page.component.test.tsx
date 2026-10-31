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
import { MyServersApiError } from "@/app/lib/hosting/my-servers";

vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    // Selects the requested namespace without reading request state.
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(), getSession: vi.fn(), managedServers: vi.fn(), preview: vi.fn(), hostedAccess: vi.fn(),
    backups: vi.fn(), backupStatus: vi.fn(), files: vi.fn(), requestBackup: vi.fn(), requestVisibility: vi.fn(), refresh: vi.fn(),
    saves: vi.fn(), generations: vi.fn(), notices: vi.fn(), move: vi.fn(),
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
    listAllMyServerBackups: mocks.backups,
    getMyServerBackupStatus: mocks.backupStatus,
    requestMyServerBackupOperation: mocks.requestBackup,
    requestServerVisibility: mocks.requestVisibility,
    listAllMyServerSaves: mocks.saves,
    getMyServerSaveGenerations: mocks.generations,
}));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({
    getMyServerSummary: mocks.managedServers,
    getMyServerDeletionStatus: async () => null,
    getMyServerNotices: mocks.notices,
    getMyServerMoveStatus: mocks.move,
}));
vi.mock("@/app/lib/hosting/servers", () => ({ getServerForRole: mocks.preview }));

const managedId = "abcdef12-1234-4123-8123-123456789abc";
const managedSummary = { serverId: managedId, accessRole: "owner", displayName: "Managed", friendlyRegion: "Europe", operationState: "running", observedGameState: "running", releaseChannel: "stable", updatedAt: "2026-10-01T00:00:00.000Z" } as const;

// Verifies the page delivers each client namespace and localized metadata.
it("composes managed, shared and cheats dictionaries without changing page access", async () => {
    const result = await ServerPage({ params: Promise.resolve({ serverId: managedId }), searchParams: Promise.resolve({}) });
    expect(result.props.locale).toBe("en");
    expect(result.props.messages).toMatchObject(serverTestMessages);
    expect(await generateMetadata()).toEqual({ title: "Manage Server", description: "Manage a Bannerlord Co-op server." });
});

// Invoke the real server page with a fixed requested identity.
function page(serverId: string = managedId) {
    return ServerPage({ params: Promise.resolve({ serverId }), searchParams: Promise.resolve({}) }).then(result => result.props.children);
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    mocks.hostedAccess.mockReturnValue(true);
    mocks.managedServers.mockResolvedValue({ ...managedSummary, accessRole: "manager" });
    // Unconfigured test environments cannot list saves, so most page tests have no active campaign.
    mocks.saves.mockRejectedValue(new MyServersApiError("server_api_not_configured", "Not configured"));
    mocks.notices.mockResolvedValue([]);
    mocks.move.mockResolvedValue(null);
});

it("redirects anonymous visitors to login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(page()).rejects.toThrow(`redirect:/login?next=/servers/${managedId}`);
    expect(mocks.managedServers).not.toHaveBeenCalled();
});

it("redirects a verified user without a session token before loading server data", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(page()).rejects.toThrow(`redirect:/login?next=/servers/${managedId}`);
    expect(mocks.managedServers).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
});

// Retired external IDs reach no managed record or preview, so every viewer returns to discovery.
it.each([true, false])("returns a retired external server ID to discovery with hosted access %s", async hostedAccess => {
    vi.stubEnv("CONSOLE_SERVER_CATALOG", JSON.stringify([{ id: "legacy-server", name: "Legacy", address: "203.0.113.10", nodeId: "node", provider: "External VPS" }]));
    try {
        mocks.hostedAccess.mockReturnValue(hostedAccess);
        mocks.managedServers.mockRejectedValue(new MyServersApiError("server_not_found", "Gone"));
        await expect(page("legacy-server")).rejects.toThrow("redirect:/servers");
        expect(mocks.managedServers).toHaveBeenCalledExactlyOnceWith("token", "legacy-server");
        expect(mocks.backups).not.toHaveBeenCalled();
        expect(mocks.files).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
});

it("renders managed pages from the requested registered server identity", async () => {
    const result = await page(managedId);
    expect(mocks.managedServers).toHaveBeenCalledExactlyOnceWith("token", managedId);
    expect(result.props.server.serverId).toBe(managedId);
});

it("keeps the controls identity stable as Start receipts appear and disappear", async () => {
    for (const start of [null, { jobId: "55555555-5555-4555-8555-555555555555" }]) {
        mocks.managedServers.mockResolvedValue({ ...managedSummary, runtimeInsight: { start } });
        const commands = await findServerElement(await page(), "ManagedServerCommands");
        const controls = await findServerElement(commands?.props.controls, "ManagedServerControls");
        expect(controls?.key).toBe(`.$${managedId}`);
    }
});

// Restores a remembered tab on the server so a reload does not flash the Console first.
it.each<[string | string[], string | undefined]>([
    ["settings", "Settings"],
    ["backups", "Backups"],
    [["save-config", "settings"], "Save & config"],
    ["mods", "Mods"],
    ["../../admin", undefined],
    ["unknown", undefined],
])("opens the managed workspace tab remembered as %j", async (tab, section) => {
    mocks.managedServers.mockResolvedValue({ serverId: managedId, accessRole: "owner", displayName: "Managed", friendlyRegion: "Europe", operationState: "running", observedGameState: "running", releaseChannel: "stable", updatedAt: "2026-10-01T00:00:00.000Z" });
    const tree = (await ServerPage({ params: Promise.resolve({ serverId: managedId }), searchParams: Promise.resolve({ tab }) })).props.children;
    const workspace = await findServerElement(tree, "ServerManagementWorkspace" as string);
    expect((workspace!.props as { initialSection?: string }).initialSection).toBe(section);
});

it("locks the managed workspace and explains initialization while the lifecycle is configuring", async () => {
    const updatedAt = "2026-10-01T00:00:00.000Z";
    mocks.managedServers.mockResolvedValue({ serverId: managedId, accessRole: "owner", displayName: "Preparing", friendlyRegion: "Europe", operationState: "configuring", observedGameState: "unknown", releaseChannel: "stable", updatedAt });
    const tree = await page(managedId);
    const workspace = await findServerElement(tree, "ServerManagementWorkspace");
    expect(workspace?.props).toMatchObject({ initialSection: "Console", interactionLocked: true });
    expect(workspace?.props.visibility.props.disabled).toBe(true);
    const status = (workspace!.props as unknown as { status: ReactElement<{ children: ReactElement }> }).status.props.children;
    const html = renderToStaticMarkup(<>{await (status.type as (props: unknown) => Promise<ReactNode>)(status.props)}</>);
    expect(html).toContain("Preparing your server");
    expect(html).toContain("up to 15 minutes");
});

it.each([
    ["running", "Paused for backup", "Backing up"],
    ["queued", "Running", "Backing up"],
    [null, "Running", "Running"],
] as const)("reports a %s backup job on a running server in the header status", async (jobState, gameState, lifecycle) => {
    const updatedAt = "2026-10-01T00:00:00.000Z";
    mocks.managedServers.mockResolvedValue({ serverId: managedId, accessRole: "owner", displayName: "Managed", friendlyRegion: "Europe", operationState: "running", observedGameState: "running", releaseChannel: "stable", updatedAt });
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

it.each([
    ["0.1.6", "v0.1.6"],
    ["v0.1.6", "v0.1.6"],
    [null, null],
    [undefined, null],
] as const)("shows installed version %j beside the release channel as %j", async (installedVersion, shown) => {
    mocks.managedServers.mockResolvedValue({ ...managedSummary, installedVersion });
    const tree = await page(managedId);
    const workspace = await findServerElement(tree, "ServerManagementWorkspace");
    const status = (workspace!.props as unknown as { status: ReactElement<{ children: ReactElement }> }).status.props.children;
    const html = renderToStaticMarkup(<>{await (status.type as (props: unknown) => Promise<ReactNode>)(status.props)}</>);
    expect(html).toContain(`Release channel</dt><dd class="font-medium text-foreground">Public`);
    if (shown === null) expect(html).not.toContain("Version</dt>");
    else expect(html).toContain(`Version</dt><dd class="font-medium text-foreground">${shown}`);
});

// Resolve the page's server components, leaving client components for React to render.
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
            if (["ManagedServerManagementPage", "ManagedServerSections", "ManagedServerBackupsSection", "UnavailableFileWorkspaces", "ManagedServerLifecycleSection"].includes(child.type.name)) {
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
    mocks.managedServers.mockResolvedValue(null);
    mocks.preview.mockReturnValue({ name: "Demo", assignedAccount: {} });
    const tree = await page("preview");
    expect(await findServerElement(tree, "ManagedServerFiles")).toBeNull();
    expect(await findServerElement(tree, "UnavailableServerPanel")).not.toBeNull();
});

it.each(["admin", "support"])("does not load private backup data for managed read-only %s access", async (accessRole) => {
    mocks.managedServers.mockResolvedValue({ ...managedSummary, accessRole });
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
    } finally { error.mockRestore(); }
});

it.each([
    ["rate-limited", new MyServersApiError("rate_limited", "Too many My Servers requests were submitted.", true), 1],
    ["busy", new MyServersApiError("busy", "Authentication capacity is busy.", true), 1],
    ["unavailable", new Error("History unavailable"), 2],
] as const)("retries a %s backup history read only when it was not rate limited", async (_case, failure, calls) => {
    mocks.backups.mockRejectedValue(failure);
    mocks.backupStatus.mockResolvedValue(null);
    mocks.files.mockResolvedValue(null);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        const files = await findServerElement(await page(), "ManagedServerFiles");
        expect(files?.props).toMatchObject({ backups: [], loadError: expect.stringContaining("It will reload automatically") });
        expect(mocks.backups).toHaveBeenCalledTimes(calls);
        expect(mocks.backupStatus).toHaveBeenCalledOnce();
    } finally { error.mockRestore(); }
});

it.each([
    ["fails briefly", new Error("Status unavailable"), 2, false],
    ["is rate limited", new MyServersApiError("rate_limited", "Too many My Servers requests were submitted.", true), 1, true],
] as const)("handles a backup status read that %s inside the shared reader", async (_case, failure, calls, failed) => {
    // React.cache shares this reader with the header only inside a server render; here the section reads alone.
    const status = { serverId: managedId, updatedAt: "2026-09-22T10:00:00.000Z", operationState: "running", observedGameState: "running", job: null };
    mocks.backups.mockResolvedValue([]);
    mocks.backupStatus.mockRejectedValueOnce(failure).mockResolvedValue(status);
    mocks.files.mockResolvedValue(null);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        const files = await findServerElement(await page(), "ManagedServerFiles");
        expect(files?.props).toMatchObject({ status: failed ? null : status, loadError: failed ? expect.any(String) : undefined });
        expect(mocks.backupStatus).toHaveBeenCalledTimes(calls);
        expect(mocks.backups).toHaveBeenCalledOnce();
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
    mocks.managedServers.mockResolvedValue({ ...managedSummary, accessRole, updatedAt, displayName: "Managed campaign" });
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

it.each(["owner", "manager", "admin", "support"])("uses managed %s authority in both visibility controls", async accessRole => {
    mocks.managedServers.mockResolvedValue({ ...managedSummary, accessRole, visibility: "public", updatedAt: "2026-09-26T12:00:00.000Z" });
    const tree = await page();
    const workspace = await findServerElement(tree, "ServerManagementWorkspace");
    const header = workspace!.props.visibility;
    const settings = await findServerElement(tree, "ServerSettingsPanel");
    expect(header.props).toEqual({ serverId: managedId, visibility: "public", accessRole, expectedUpdatedAt: "2026-09-26T12:00:00.000Z", disabled: false });
    expect(settings!.props.visibility).toBe("public");
    expect(settings!.props.visibilityAccess).toEqual({ serverId: managedId, expectedUpdatedAt: "2026-09-26T12:00:00.000Z", canEdit: accessRole === "owner" });
});

it("supplies current maintenance preferences for the managed identity", async () => {
    mocks.managedServers.mockResolvedValue({ serverId: managedId, accessRole: "owner", displayName: "Owned server",
        friendlyRegion: "us-west", observedGameState: "stopped", operationState: "drifted", releaseChannel: "stable", visibility: "private",
        maintenanceSlot: "18:00-19:00", timezone: "America/Chicago", updatedAt: "2026-10-01T00:00:00.000Z" });
    const settings = await findServerElement(await page(managedId), "ServerSettingsPanel");
    expect(settings!.props.settingsAccess).toEqual({ serverId: managedId, expectedUpdatedAt: "2026-10-01T00:00:00.000Z",
        maintenanceSlot: "18:00-19:00", timezone: "America/Chicago", canEdit: true });
    expect(settings!.props.name).toBe("Owned server");
});

it("keeps preview visibility non-operational without a managed server", async () => {
    mocks.managedServers.mockResolvedValue(null);
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
    mocks.managedServers.mockResolvedValue({ ...managedSummary, visibility: "private", updatedAt });
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
        mocks.managedServers.mockResolvedValue({ ...managedSummary, visibility: "public", updatedAt: nextUpdatedAt });
        await renderVisibility();
        expect(container.querySelector("summary")!.textContent).toContain("Public");
        expect(container.querySelector<HTMLInputElement>('input[value="public"]')!.checked).toBe(true);
        await act(async () => container.querySelector<HTMLInputElement>('input[value="private"]')!.click());
        await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        expect(mocks.requestVisibility).toHaveBeenLastCalledWith("token", { action: "set-server-visibility", serverId: managedId, visibility: "private", expectedUpdatedAt: nextUpdatedAt }, expect.any(String));
        expect(mocks.refresh).toHaveBeenCalledTimes(2);
        expect(container.querySelector("summary")!.textContent).toContain("Public");
        mocks.managedServers.mockResolvedValue({ ...managedSummary, visibility: "private", updatedAt: "2026-09-26T12:02:00.000Z" });
        await renderVisibility();
        expect(container.querySelector("summary")!.textContent).toContain("Private");
        expect(container.querySelector<HTMLInputElement>('input[value="private"]')!.checked).toBe(true);
        expect(confirm).toHaveBeenCalledOnce();
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
    }
});

// Console matrix: managed owners/managers get commands and output; read-only roles do not.
it.each(["owner", "manager", "support", "admin"])("preserves managed console access for %s in the workspace", async (accessRole) => {
    mocks.managedServers.mockResolvedValue({
        serverId: managedId, accessRole, observedGameState: "running", operationState: "idle", friendlyRegion: "europe",
    });
    const tree = await page(managedId);
    const workspace = await findServerElement(tree, "ServerWorkspacePanel");
    expect(workspace?.props.section).toBe("Console");
    const operator = accessRole === "owner" || accessRole === "manager";
    const commands = await findServerElement(workspace, "ManagedServerCommands");
    expect(commands?.props.server.serverId).toBe(operator ? managedId : undefined);
});

it("places managed password configuration in Settings rather than the Console workspace", async () => {
    mocks.managedServers.mockResolvedValue({
        serverId: managedId, accessRole: "owner", observedGameState: "running", operationState: "running", friendlyRegion: "europe",
    });
    const tree = await page(managedId);
    const sections = (await findServerElement(tree, "ManagedServerSections"))!;
    const renderSections = sections.type as (props: unknown) => ReactElement<{ children: ReactNode }>;
    // The panels sit inside the maintenance provider that shares Update now with the Save & config tab.
    const maintenance = renderSections(sections.props).props.children as ReactElement<{ children: ReactNode }>;
    const panels = Children.toArray(maintenance.props.children);
    const settings = panels.find(child => isValidElement<{ section?: string }>(child) && child.props.section === "Settings");
    const consolePanel = panels.find(child => isValidElement<{ section?: string }>(child) && child.props.section === "Console");
    expect(await findServerElement(settings, "ManagedServerPassword")).toMatchObject({ props: { serverId: managedId, accessRole: "owner" } });
    expect(await findServerElement(consolePanel, "ManagedServerPassword")).toBeNull();
});

it("surfaces an unexpected single-server read failure instead of treating the server as missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        const failure = new Error("Unavailable");
        mocks.managedServers.mockRejectedValueOnce(failure);
        await expect(page()).rejects.toThrow("Unavailable");
        expect(error).toHaveBeenCalledExactlyOnceWith("Managed server detail failed to load", failure);
    } finally { error.mockRestore(); }
    expect(mocks.backups).not.toHaveBeenCalled();
    expect(mocks.files).not.toHaveBeenCalled();
});

it.each(["server_not_found", "forbidden"])("returns to discovery without managed controls when the single-server read returns %s", async code => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        mocks.managedServers.mockRejectedValueOnce(new MyServersApiError(code, "Unavailable"));
        await expect(page()).rejects.toThrow("redirect:/servers");
        expect(mocks.managedServers).toHaveBeenCalledExactlyOnceWith("token", managedId);
        // An expected unknown-server answer is not logged as a failure.
        expect(error).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
    expect(mocks.backups).not.toHaveBeenCalled();
    expect(mocks.files).not.toHaveBeenCalled();
});

it("reads the active campaign's autosaves for Backups and reports a failed read without pausing backups", async () => {
    const saveId = "77777777-7777-4777-8777-777777777777";
    const updatedAt = "2026-10-16T10:00:00.000Z";
    const items = [{ generation: "current", byteSize: 4_096, lastModifiedAt: "2026-10-16T09:56:00.000Z", observedAt: "2026-10-16T09:58:00.000Z" }];
    const savePage = (activeSaveId: string | null) => ({ serverId: managedId, updatedAt, activeSaveId, nextCursor: null, items: [
        { saveId: "88888888-8888-4888-8888-888888888888", displayName: "Older campaign", byteSize: 1, createdAt: updatedAt, lastUsedAt: null, importedBy: "owner" },
        { saveId, displayName: "Northern March", byteSize: 4_096, createdAt: updatedAt, lastUsedAt: updatedAt, importedBy: "owner" },
    ] });
    mocks.backups.mockResolvedValue([]);
    mocks.backupStatus.mockResolvedValue({ serverId: managedId, updatedAt, operationState: "stopped", observedGameState: "stopped", job: null });
    mocks.files.mockResolvedValue(null);
    mocks.saves.mockResolvedValue(savePage(saveId));
    mocks.generations.mockResolvedValue({ serverId: managedId, saveId, items });
    let files = await findServerElement(await page(), "ManagedServerFiles");
    expect(mocks.generations).toHaveBeenCalledExactlyOnceWith("token", managedId, saveId);
    expect(files?.props).toMatchObject({ autosaves: { saveId, campaignName: "Northern March", items }, autosaveLoadError: undefined, loadError: undefined });

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        mocks.generations.mockRejectedValue(new MyServersApiError("invalid_response", "Invalid"));
        files = await findServerElement(await page(), "ManagedServerFiles");
        expect(files?.props).toMatchObject({ autosaves: null, autosaveLoadError: expect.stringContaining("Recent autosaves couldn’t be loaded"), loadError: undefined });
        expect(error).toHaveBeenCalledWith("Managed server autosaves failed to load");
    } finally { error.mockRestore(); }

    // Without an active campaign there are no autosaves to read or report.
    mocks.generations.mockClear();
    mocks.saves.mockResolvedValue(savePage(null));
    files = await findServerElement(await page(), "ManagedServerFiles");
    expect(mocks.generations).not.toHaveBeenCalled();
    expect(files?.props).toMatchObject({ autosaves: null, autosaveLoadError: undefined });
});

const pageNotice = {
    noticeId: "66666666-6666-4666-8666-666666666666", kind: "administrator", severity: "info", title: "Maintenance tonight",
    body: "Expect a short outage.", parameters: {}, createdAt: "2026-10-18T09:00:00.000Z", expiresAt: null,
} as const;

// The banner slot holds the move status card first, then the notice cards.
function bannerParts(workspace: ReactElement | null) {
    const banner = (workspace!.props as { banner?: ReactElement<{ children: ReactNode }> }).banner;
    const [move, notices] = Children.toArray(banner?.props.children) as ReactElement[];
    return { move: move as ReactElement<{ notices: unknown[] }> | undefined, notices: notices as ReactElement<{ serverId: string; notices: unknown[] }> | undefined };
}

const moving = { state: "moving", scheduledAt: null, startedAt: "2026-10-18T09:00:00.000Z", completedAt: null, step: "restoring", address: null, stayedOnOriginal: null } as const;

it("shows this viewer's notices below the move status at the top of the page", async () => {
    mocks.managedServers.mockResolvedValue(managedSummary);
    mocks.notices.mockResolvedValue([pageNotice]);
    mocks.move.mockResolvedValue(moving);
    const tree = await page(managedId);
    const workspace = await findServerElement(tree, "ServerManagementWorkspace" as string);
    const { move, notices } = bannerParts(workspace);
    expect((move?.type as { name?: string }).name).toBe("ManagedServerMoveStatus");
    expect(move?.props).toEqual({ notices: [pageNotice] });
    expect(notices?.props).toEqual({ serverId: managedId, notices: [pageNotice] });
    expect((await findServerElement(tree, "ManagedServerMoveProvider"))?.props).toMatchObject({ serverId: managedId, initialMove: moving });
    expect(mocks.notices).toHaveBeenCalledWith("token", managedId, expect.any(AbortSignal));
    expect(mocks.move).toHaveBeenCalledWith("token", managedId, expect.any(AbortSignal));
});

it.each([
    ["fails", () => { mocks.notices.mockRejectedValue(new MyServersApiError("invalid_request", "Unknown operation")); }],
    ["is empty", () => { mocks.notices.mockResolvedValue([]); }],
])("renders the page with only the move status when the notice read %s", async (_case, arrange) => {
    arrange();
    mocks.managedServers.mockResolvedValue({ ...managedSummary, accessRole: "manager" });
    const workspace = await findServerElement(await page(managedId), "ServerManagementWorkspace" as string);
    expect(workspace).not.toBeNull();
    const { move, notices } = bannerParts(workspace);
    expect(move?.props).toEqual({ notices: [] });
    expect(notices).toBeUndefined();
});

it("follows no move when the control plane cannot report one, such as an older release", async () => {
    mocks.managedServers.mockResolvedValue(managedSummary);
    mocks.move.mockRejectedValue(new MyServersApiError("invalid_request", "Unknown operation"));
    const tree = await page(managedId);
    expect((await findServerElement(tree, "ManagedServerMoveProvider"))?.props).toMatchObject({ serverId: managedId, initialMove: null });
    expect(await findServerElement(tree, "ServerManagementWorkspace" as string)).not.toBeNull();
});

it.each([
    ["moving", "Moving to a new machine"],
    ["returning", "Moving back to its original machine"],
    ["scheduled", "Maintenance"],
    [null, "Maintenance"],
] as const)("names a %s move in the header status instead of maintenance", async (state, lifecycle) => {
    mocks.managedServers.mockResolvedValue({ ...managedSummary, operationState: "maintenance", observedGameState: "stopped" });
    mocks.move.mockResolvedValue(state === null ? null : state === "scheduled"
        ? { ...moving, state, scheduledAt: "2026-10-19T03:00:00.000Z", startedAt: null, step: null }
        : { ...moving, state });
    const workspace = await findServerElement(await page(managedId), "ServerManagementWorkspace" as string);
    const status = (workspace!.props as { status: ReactElement<{ children: ReactElement; fallback: ReactElement }> }).status.props;
    for (const element of [status.children, status.fallback]) {
        const html = renderToStaticMarkup(<>{await (element.type as (props: unknown) => Promise<ReactNode>)(element.props)}</>);
        expect(html).toContain(`Lifecycle</dt><dd class="font-medium text-foreground">${lifecycle}`);
    }
});

it("gives the move status the header's address", async () => {
    mocks.managedServers.mockResolvedValue({ ...managedSummary, connectionIp: "198.51.100.20", gamePorts: [4203] });
    const tree = await page(managedId);
    expect((await findServerElement(tree, "ServerManagementWorkspace" as string) as ReactElement<{ address?: string | null }>).props.address).toBe("198.51.100.20:4203");
    expect((await findServerElement(tree, "ManagedServerMoveProvider"))?.props).toMatchObject({ headerAddress: "198.51.100.20:4203" });
});

it.each([
    ["sleeper", "running", null, "Sleeping — wakes when a player connects"],
    ["admin hold", "stopped", null, "Suspended"],
    ["subscription hold", "stopped", { state: "held", reason: "subscription-funding-lapsed", removalDueAt: "2026-11-01T00:00:00.000Z", canExportSave: true }, "Suspended"],
    ["subscription hold with running intent", "running", { state: "held", reason: "subscription-funding-lapsed", removalDueAt: "2026-11-01T00:00:00.000Z", canExportSave: true }, "Suspended"],
    ["legacy unknown intent", undefined, null, "Suspended"],
])("labels %s in the owner header", async (_name, desiredState, subscriptionHold, label) => {
    mocks.managedServers.mockResolvedValue({ ...managedSummary, operationState: "suspended", observedGameState: "stopped",
        runtimeInsight: desiredState ? { desiredState, allowedActions: [] } : undefined, subscriptionHold });
    const workspace = await findServerElement(await page(), "ServerManagementWorkspace");
    const status = (workspace!.props as unknown as { status: ReactElement<{ children: ReactElement }> }).status.props.children;
    const html = renderToStaticMarkup(<>{await (status.type as (props: unknown) => Promise<ReactNode>)(status.props)}</>);
    expect(html).toContain(`Lifecycle</dt><dd class="font-medium text-foreground">${label}`);
    if (label === "Suspended") expect(html).not.toContain("Sleeping");
});
