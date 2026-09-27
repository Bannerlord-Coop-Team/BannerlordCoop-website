import { act, Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION } from "../../../../supabase/functions/_shared/managed-server-configuration";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";
import ServerPage from "./page";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";

const mocks = vi.hoisted(() => ({ live: vi.fn(), access: vi.fn(), servers: vi.fn(), files: vi.fn(), submit: vi.fn(), preview: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(url); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: { id: "user" } } }),
    getSession: async () => ({ data: { session: { access_token: "token" } } }),
} }) }));
vi.mock("@/app/lib/supabase/users", () => ({ listSupabaseUsers: async () => ({ users: [], truncated: false }) }));
vi.mock("@/app/lib/console/servers", () => ({ getLiveConsoleServer: mocks.live, getConsoleGatewayUrl: () => null }));
vi.mock("@/app/lib/auth/access", () => ({ getLiveConsoleAccessLevel: mocks.access, getMemberRole: () => "Admin", hasHostedServerAccess: () => true }));
vi.mock("@/app/lib/hosting/my-servers", async (original) => ({
    ...await original<typeof import("@/app/lib/hosting/my-servers")>(),
    listAllMyServers: mocks.servers, listAllMyServerBackups: async () => [], getMyServerBackupStatus: async () => null,
}));
vi.mock("@/app/lib/hosting/server-files", () => ({ getMyServerFiles: mocks.files, submitMyServerFile: mocks.submit }));
vi.mock("@/app/lib/hosting/server-settings", () => ({ getServerDisplayNames: async () => new Map() }));
vi.mock("@/app/lib/hosting/servers", () => ({ getServerForRole: mocks.preview }));

const managedId = "abcdef12-1234-4123-8123-123456789abc";
const live = { id: "live-server", name: "Live", managedServerId: managedId };
const status: OwnerFileStatus = { serverId: managedId, updatedAt: "2026-09-26T00:00:00.000Z", operationState: "stopped", observedGameState: "stopped",
    activeSave: { saveId: "22222222-2222-4222-8222-222222222222", displayName: "Real mapped campaign" }, managedConfig: DEFAULT_MANAGED_SERVER_CONFIGURATION };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); sessionStorage.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    mocks.live.mockReturnValue(live); mocks.access.mockReturnValue("operator");
    mocks.servers.mockResolvedValue([{ serverId: managedId, accessRole: "owner" }]);
    mocks.files.mockResolvedValue(status);
    mocks.submit.mockResolvedValue({ kind: "job", outcome: "enqueued", jobId: "33333333-3333-4333-8333-333333333333", action: "export-save", state: "queued" });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

// Resolve actual server components and retain the real client transfer UI and server actions.
async function find(node: ReactNode, name: string): Promise<ReactElement | null> {
    for (const child of Children.toArray(node)) {
        if (!isValidElement<{ children?: ReactNode }>(child)) continue;
        if (typeof child.type === "function") {
            if (child.type.name === name) return child;
            if (["LiveServerManagementPage", "ManagedServerSections", "ManagedServerBackupsSection", "UnavailableFileWorkspaces"].includes(child.type.name)) {
                const component = child.type as (props: unknown) => ReactNode | Promise<ReactNode>;
                const found = await find(await component(child.props), name);
                if (found) return found;
                continue;
            }
        }
        const found = await find(child.props.children, name);
        if (found) return found;
    }
    return null;
}
async function page() { return ServerPage({ params: Promise.resolve({ serverId: live.id }), searchParams: Promise.resolve({}) }); }
async function render(name = "ManagedServerFiles") {
    const element = await find(await page(), name);
    expect(element).not.toBeNull();
    await act(async () => root.render(<ManagedServerPollingProvider>{element}</ManagedServerPollingProvider>));
    await act(async () => vi.advanceTimersByTimeAsync(0));
}
function button(label: string) {
    const found = [...container.querySelectorAll("button")].find((button) => button.textContent === label);
    if (!found) throw Error(`Missing ${label}`);
    return found;
}

it.each(["mapping-required", "access-required", "lookup-failed"])("provides file-specific %s guidance with inert transfers", async (reason) => {
    // A different owned record cannot authorize this live server's files.
    mocks.servers.mockResolvedValue([{ serverId: "another-server", accessRole: "owner" }]);
    if (reason === "mapping-required") mocks.live.mockReturnValue({ ...live, managedServerId: undefined });
    if (reason === "lookup-failed") {
        mocks.servers.mockRejectedValue(Error("Unavailable"));
        vi.spyOn(console, "error").mockImplementation(() => {});
    }
    await render("LiveServerFileSetup");
    expect(container.textContent).toContain(reason === "lookup-failed" ? "does not mean your save or configuration is missing" : reason === "mapping-required" ? "not connected to managed file transfers" : "linked managed server is unavailable");
    if (reason === "lookup-failed") {
        expect(container.querySelector("form")?.getAttribute("action")).toBe("/servers/live-server#server-files");
        expect(container.querySelector("form")?.method).toBe("get");
        expect(container.textContent).not.toContain("Creating a new managed server");
    } else {
        expect(container.textContent).toContain("Only the managed owner can import configuration");
        expect(container.querySelector("a")?.getAttribute("href")).toBe("/servers");
    }
    for (const label of ["Import save", "Export save", "Import config", "Export config"]) expect(button(label).disabled).toBe(true);
    expect(mocks.files).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
});

it.each(["owner", "manager"])("shows actual mapped save/config for managed %s and permits only owner save exports", async (accessRole) => {
    mocks.servers.mockResolvedValue([{ serverId: managedId, accessRole }]);
    await render();
    expect(mocks.files).toHaveBeenCalledExactlyOnceWith("token", managedId);
    expect(container.textContent).toContain(status.activeSave!.displayName);
    expect(JSON.parse(container.querySelector<HTMLTextAreaElement>("#config-json")!.value)).toEqual(status.managedConfig);
    expect(button("Import save").disabled).toBe(false);
    expect(button("Export config").disabled).toBe(false);
    expect(button("Import config").disabled).toBe(accessRole !== "owner");
    expect(button("Export save").disabled).toBe(accessRole !== "owner");
    await act(async () => button("Export save").click());
    if (accessRole !== "owner") { expect(mocks.submit).not.toHaveBeenCalled(); return; }
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("token", expect.stringMatching(/^[0-9a-f-]{36}$/), {
        serverId: managedId, action: "export-save", saveId: status.activeSave!.saveId, expectedUpdatedAt: status.updatedAt,
    });
});

it.each(["running", "restoring"])("retains managed save restrictions while %s", async (operationState) => {
    mocks.files.mockResolvedValue({ ...status, operationState, observedGameState: "running" });
    await render();
    expect(button("Import save").disabled).toBe(true);
    expect(button("Export save").disabled).toBe(operationState !== "running");
});

it("keeps missing file status distinct from missing mapping and disables transfers", async () => {
    mocks.files.mockRejectedValue(Error("Files unavailable"));
    await render();
    expect(container.textContent).not.toContain("Connect save and configuration transfers");
    for (const label of ["Import save", "Export save", "Import config", "Export config"]) expect(button(label).disabled).toBe(true);
});

it.each(["admin", "support"])("keeps managed %s read-only even for a live owner", async (accessRole) => {
    mocks.access.mockReturnValue("owner"); mocks.servers.mockResolvedValue([{ serverId: managedId, accessRole }]);
    await render();
    expect(container.textContent).toContain("require owner or manager access");
    expect(mocks.files).not.toHaveBeenCalled();
    for (const label of ["Import save", "Export save", "Import config", "Export config"]) expect(button(label).disabled).toBe(true);
});

it("opens import review without submitting or bypassing existing confirmation", async () => {
    await render();
    await act(async () => button("Import config").click());
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(button("Review import")).toBeDefined();
    expect(mocks.submit).not.toHaveBeenCalled();
});

it("keeps fictional previews inert without live onboarding", async () => {
    mocks.live.mockReturnValue(null); mocks.servers.mockResolvedValue([]); mocks.preview.mockReturnValue({ name: "Preview", assignedAccount: {} });
    const tree = await page();
    expect(await find(tree, "LiveServerFileSetup")).toBeNull();
    expect(await find(tree, "ManagedServerFiles")).toBeNull();
    await render("ServerSaveConfigPanels");
    for (const label of ["Import save", "Export save", "Import config", "Export config"]) expect(button(label).disabled).toBe(true);
});
