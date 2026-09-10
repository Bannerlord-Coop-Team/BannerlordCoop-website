import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneActionCard, type AdminActionField } from "./ControlPlaneActionCard";
import type { Backup, HostingPage } from "@/app/lib/control-plane/types";

const { request, session } = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const servers: AdminActionField = { name: "serverId", label: "Server", kind: "server", required: true, options: [
    { label: "Alpha", value: "server-a", updatedAt: "2026-09-06T12:00:00Z", releaseChannel: "stable" },
    { label: "Bravo", value: "server-b", updatedAt: "2026-09-06T12:00:00Z", releaseChannel: "nightly" },
] };
const backup: Backup = { backupId: "backup-a", serverId: "server-a", backupType: "manual", byteSize: 1024,
    buildId: "stable-build", saveId: null, createdAt: "2026-09-06T12:00:00Z", retentionExpiresAt: "2099-09-06T12:00:00Z",
    restoreState: "available", lastErrorCode: null };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function renderRestore() {
    await act(async () => root.render(<ControlPlaneActionCard operation="restore-backup" title="Restore backup" description="Restore"
        fields={[servers, { name: "backupId", label: "Backup", kind: "backup", required: true }]} />));
}
async function select(name: string, index: number) {
    const element = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
    await act(async () => { element.selectedIndex = index; element.dispatchEvent(new Event("change", { bubbles: true })); });
}
function submit() { return container.querySelector<HTMLButtonElement>('button[type="submit"]')!; }
it("loads backups on server selection and clears a previous server's selected backup", async () => {
    let resolveBravo!: (page: HostingPage<Backup>) => void;
    request.mockResolvedValueOnce({ items: [backup], nextCursor: null });
    request.mockImplementationOnce(() => new Promise((resolve) => { resolveBravo = resolve; }));
    await renderRestore(); expect(submit().disabled).toBe(true);
    await select("serverId", 1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ operation: "backups", input: { serverId: "server-a", limit: 100 } });
    await select("backupId", 1); expect(submit().disabled).toBe(false);
    expect(container.textContent).toContain("stable-build");
    await select("serverId", 2); expect(submit().disabled).toBe(true);
    expect(container.querySelector('option[value="backup-a"]')).toBeNull();
    await act(async () => resolveBravo({ items: [], nextCursor: null }));
    expect(container.textContent).toContain("No restorable backups");
    expect(submit().disabled).toBe(true);
});
it("ignores a late response for a previously selected server", async () => {
    let resolveAlpha!: (page: HostingPage<Backup>) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { resolveAlpha = resolve; }));
    request.mockResolvedValueOnce({ items: [], nextCursor: null });
    await renderRestore(); await select("serverId", 1); await select("serverId", 2);
    await act(async () => resolveAlpha({ items: [backup], nextCursor: null }));
    expect(container.querySelector('option[value="backup-a"]')).toBeNull();
    expect(submit().disabled).toBe(true);
});
it("retries failed backup reads and loads older pages without keeping a stale selection", async () => {
    request.mockRejectedValueOnce(new Error("Temporary failure"));
    request.mockResolvedValueOnce({ items: [backup], nextCursor: "older-page" });
    request.mockResolvedValueOnce({ items: [], nextCursor: null });
    await renderRestore(); await select("serverId", 1);
    expect(container.textContent).toContain("Temporary failure");
    const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;
    await act(async () => button("Retry").click());
    await select("backupId", 1); expect(submit().disabled).toBe(false);
    await act(async () => button("Older backups").click());
    expect(request.mock.calls[2]?.[0].input).toMatchObject({ serverId: "server-a", cursor: "older-page" });
    expect(submit().disabled).toBe(true);
});
it("offers only the selected channel's builds and sends pinning as one update request", async () => {
    request.mockResolvedValue({ outcome: "enqueued", job: { jobId: "job-a", serverId: "server-a", action: "update", state: "queued" } });
    await act(async () => root.render(<ControlPlaneActionCard operation="update-server" title="Update server" description="Update"
        fields={[servers, { name: "buildId", label: "Build", kind: "select", required: true, options: [
            { label: "Latest", value: "__latest__" },
            { label: "Stable release", value: "stable-build", releaseChannel: "stable" },
            { label: "Nightly release", value: "nightly-build", releaseChannel: "nightly" },
        ] }]} />));
    await select("serverId", 1);
    expect(container.querySelector('option[value="nightly-build"]')).toBeNull();
    await select("buildId", 2);
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toMatchObject({ operation: "update-server", input: { serverId: "server-a", buildId: "stable-build", expectedUpdatedAt: "2026-09-06T12:00:00Z" } });
});

it("sends only bearer and closed request fields for an unlinked Supabase Admin", async () => {
    session.mockResolvedValue({ data: { session: { access_token: "test-only", user: { id: "22222222-2222-4222-8222-222222222222", app_metadata: { role: "Admin" }, identities: [] } } } });
    request.mockResolvedValue({ healthy: true });
    await act(async () => root.render(<ControlPlaneActionCard operation="overview" title="Overview" description="Read fleet" fields={[]} />));
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(request).toHaveBeenCalledExactlyOnceWith({ accessToken: "test-only", requestId: expect.any(String), operation: "overview" });
});

it("resets the server and backup state with the form after an action", async () => {
    request.mockResolvedValue({ items: [backup], nextCursor: null });
    await renderRestore(); await select("serverId", 1); await select("backupId", 1);
    expect(submit().disabled).toBe(false);
    await act(async () => container.querySelector("form")!.reset());
    expect(submit().disabled).toBe(true);
    expect(container.querySelector('select[name="backupId"]')).toBeNull();
    expect(container.querySelector<HTMLSelectElement>('select[name="serverId"]')?.value).toBe("");
});
