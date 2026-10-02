import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerCampaigns } from "./ManagedServerCampaigns";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION } from "../../../../supabase/functions/_shared/managed-server-configuration";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";

const mocks = vi.hoisted(() => ({ list: vi.fn(), change: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/servers/managed-server-campaign-actions", () => ({ listManagedServerCampaigns: mocks.list, changeManagedServerCampaign: mocks.change }));

const serverId = "11111111-1111-4111-8111-111111111111";
const defaultId = "22222222-2222-4222-8222-222222222222";
const importedId = "33333333-3333-4333-8333-333333333333";
const freshId = "44444444-4444-4444-8444-444444444444";
const stopped: OwnerFileStatus = { serverId, updatedAt: "2026-10-02T12:00:00.000Z", operationState: "stopped", observedGameState: "stopped",
    activeSave: { saveId: defaultId, displayName: "Default New Game" }, managedConfig: DEFAULT_MANAGED_SERVER_CONFIGURATION };
const campaigns = { serverId, updatedAt: stopped.updatedAt, activeSaveId: defaultId, items: [
    { saveId: defaultId, displayName: "Default New Game", byteSize: 6_144_000, createdAt: "2026-09-30T00:00:00.000Z", lastUsedAt: null, importedBy: "system" as const },
    { saveId: importedId, displayName: "Imported Campaign", byteSize: 9_000_000, createdAt: "2026-10-01T00:00:00.000Z", lastUsedAt: null, importedBy: "owner" as const },
] };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    mocks.list.mockResolvedValue({ ok: true, campaigns });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function render(status: OwnerFileStatus | null = stopped) {
    await act(async () => root.render(<ManagedServerCampaigns userId="owner" serverId={serverId} status={status} />));
    await act(async () => vi.advanceTimersByTimeAsync(0));
}
function button(label: string) { const found = [...container.querySelectorAll("button")].find((el) => el.textContent === label); if (!found) throw Error(`Missing button ${label}`); return found; }
function dialog() { return container.querySelector("dialog")!; }

it("lists campaigns with the selection marked and only offers switching while the server is stopped", async () => {
    await render({ ...stopped, operationState: "running", observedGameState: "running" });
    expect(mocks.list).toHaveBeenCalledWith(serverId, "owner");
    expect(container.textContent).toContain("Default New Game"); expect(container.textContent).toContain("Selected");
    expect(container.textContent).toContain("Imported Campaign"); expect(container.textContent).toContain("Stop the server to switch campaigns");
    expect(button("Use this campaign").disabled).toBe(true); expect(button("New campaign").disabled).toBe(true);
    await act(async () => root.render(<ManagedServerCampaigns userId="owner" serverId={serverId} status={stopped} />));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(button("Use this campaign").disabled).toBe(false); expect(button("New campaign").disabled).toBe(false);
});

it("selects an imported campaign with a durable request bound to the listed server revision", async () => {
    mocks.change.mockResolvedValue({ ok: true, selection: { serverId, activeSaveId: importedId, updatedAt: "2026-10-02T12:00:01.000Z" } });
    await render();
    await act(async () => button("Use this campaign").click());
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), action: "select-save", saveId: importedId, serverId, expectedUpdatedAt: stopped.updatedAt }, "owner");
    expect(container.textContent).toContain("Campaign selected");
    expect(mocks.refresh).toHaveBeenCalled();
});

it("starts a new campaign only after confirmation, replays the same request on retry, and reports completion when the selection changes", async () => {
    mocks.change.mockResolvedValueOnce({ ok: false, notSubmitted: false, refresh: false, message: "Connection interrupted." });
    await render();
    expect(dialog().open).toBe(false);
    await act(async () => button("New campaign").click());
    expect(dialog().open).toBe(true);
    expect(container.textContent).toContain("deletes every campaign");
    await act(async () => button("Delete saves and start fresh").click());
    const first = mocks.change.mock.calls[0]![0] as { requestId: string };
    expect(mocks.change).toHaveBeenCalledWith({ requestId: first.requestId, action: "reset-campaign", serverId, expectedUpdatedAt: stopped.updatedAt }, "owner");
    expect(container.textContent).toContain("Connection interrupted.");
    mocks.change.mockResolvedValueOnce({ ok: true, reset: { outcome: "enqueued", jobId: freshId, action: "reset-campaign" } });
    await act(async () => button("Delete saves and start fresh").click());
    expect((mocks.change.mock.calls[1]![0] as { requestId: string }).requestId).toBe(first.requestId);
    expect(dialog().open).toBe(false);
    expect(container.textContent).toContain("Preparing your fresh campaign");
    // Polling notices the fresh default once the control plane re-seeds it.
    mocks.list.mockResolvedValue({ ok: true, campaigns: { ...campaigns, activeSaveId: freshId, items: [{ ...campaigns.items[0]!, saveId: freshId }] } });
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toContain("Your fresh campaign is ready");
    expect(button("New campaign").disabled).toBe(false);
});

it("shows load failures without hiding the controls and refuses changes before status is known", async () => {
    mocks.list.mockResolvedValue({ ok: false, message: "The campaign list could not be loaded. Try again." });
    await render(null);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    expect(container.textContent).toContain("unavailable until the server status loads");
    expect(button("New campaign").disabled).toBe(true);
    expect(mocks.change).not.toHaveBeenCalled();
});
