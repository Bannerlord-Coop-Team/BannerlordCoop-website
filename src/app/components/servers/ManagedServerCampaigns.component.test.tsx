import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerCampaigns } from "./ManagedServerCampaigns";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION } from "../../../../supabase/functions/_shared/managed-server-configuration";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";

const mocks = vi.hoisted(() => ({ list: vi.fn(), change: vi.fn(), deleteSave: vi.fn(), deletionStatus: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/servers/managed-server-campaign-actions", () => ({ listManagedServerCampaigns: mocks.list, changeManagedServerCampaign: mocks.change }));
vi.mock("@/app/servers/managed-server-save-actions", () => ({ deleteManagedServerSave: mocks.deleteSave, readManagedServerSaveDeletion: mocks.deletionStatus }));

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
    localStorage.clear();
    mocks.deletionStatus.mockResolvedValue({ ok: false, message: "Deletion status unavailable." });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    mocks.list.mockResolvedValue({ ok: true, campaigns });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function render(status: OwnerFileStatus | null = stopped, canDelete = false) {
    await act(async () => root.render(<ManagedServerCampaigns userId="owner" serverId={serverId} status={status} canDelete={canDelete} />));
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

it("explains why campaign controls are disabled while the server is running", async () => {
    await render({ ...stopped, operationState: "running", observedGameState: "running" });
    const tooltips = [...container.querySelectorAll('[role="tooltip"]')].map((element) => element.textContent);
    expect(tooltips).toContain("Stop the server before starting a new campaign.");
    expect(tooltips).toContain("Stop the server before switching campaigns.");
});

it("keeps New campaign disabled on a server that never started because its first Start creates the campaign", async () => {
    mocks.list.mockResolvedValue({ ok: true, campaigns: { serverId, updatedAt: stopped.updatedAt, activeSaveId: null, items: [] } });
    await render({ ...stopped, operationState: "awaiting-save", activeSave: null });
    expect(container.textContent).toContain("No campaigns are registered yet. Starting the server creates a fresh one.");
    expect(button("New campaign").disabled).toBe(true);
    const tooltips = [...container.querySelectorAll('[role="tooltip"]')].map((element) => element.textContent);
    expect(tooltips).toContain("This server has no campaign yet. Starting it creates a fresh one.");
    await act(async () => button("New campaign").click());
    expect(dialog().open).toBe(false);
    expect(mocks.change).not.toHaveBeenCalled();
});

it("selects an imported campaign with a durable request bound to the listed server revision", async () => {
    mocks.change.mockResolvedValue({ ok: true, selection: { serverId, activeSaveId: importedId, updatedAt: "2026-10-02T12:00:01.000Z" } });
    await render(stopped, true);
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

it("deletes only an inactive imported campaign after exact-name confirmation", async () => {
    mocks.deleteSave.mockResolvedValue({ ok: true, jobId: freshId, message: "Campaign deletion queued." });
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("prompt", vi.fn(() => "Imported Campaign"));
    await render(stopped, true);
    const deleteButton = container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement;
    expect(deleteButton).toBeTruthy();
    expect((container.querySelector('[aria-label="Delete Default New Game"]') as HTMLButtonElement | null)).toBeNull();
    await act(async () => deleteButton.click());
    expect(mocks.deleteSave).toHaveBeenCalledWith({ serverId, saveId: importedId, expectedUpdatedAt: stopped.updatedAt, confirmationText: "Imported Campaign", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) }, "owner");
});

const deletionKey = `campaign-deletion:v1:owner:${serverId}`;
const retainedInput = { serverId, saveId: importedId, expectedUpdatedAt: stopped.updatedAt, confirmationText: "Imported Campaign", requestId: freshId };
function statusResult(state: string, message: string) {
    return { ok: true, status: { serverId, jobId: freshId, saveId: importedId, state, errorCode: state === "failed" ? "save_still_loaded" : null }, message };
}

it("reattaches after refresh and shows queued, running, retry-wait and a terminal failure without another mutation", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: freshId }));
    mocks.deletionStatus.mockResolvedValueOnce(statusResult("queued", "Queued"))
        .mockResolvedValueOnce(statusResult("running", "Running"))
        .mockResolvedValueOnce(statusResult("retry-wait", "Waiting to retry"))
        .mockResolvedValueOnce(statusResult("failed", "This campaign is still loaded."));
    await render(stopped, true);
    expect(container.textContent).toContain("Queued");
    for (const message of ["Running", "Waiting to retry", "This campaign is still loaded."]) {
        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        expect(container.textContent).toContain(message);
    }
    expect(mocks.deleteSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.deletionStatus).toHaveBeenCalledTimes(4);
    expect(JSON.parse(localStorage.getItem(deletionKey)!).jobId).toBe(freshId);
});

it("recovers a lost reply using the exact persisted request across a refresh", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "Imported Campaign"));
    mocks.deleteSave.mockImplementationOnce(async (input) => {
        expect(JSON.parse(localStorage.getItem(deletionKey)!).input).toEqual(input);
        throw new Error("lost reply");
    });
    await render(stopped, true);
    await act(async () => (container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).click());
    const original = mocks.deleteSave.mock.calls[0]![0];
    await act(async () => root.unmount()); root = createRoot(container);
    await render(stopped, true);
    expect(mocks.deleteSave).toHaveBeenCalledTimes(1);
    mocks.deleteSave.mockResolvedValueOnce({ ok: true, jobId: freshId, message: "Queued" });
    mocks.deletionStatus.mockResolvedValueOnce(statusResult("succeeded", "Campaign deleted."));
    await act(async () => button("Recover deletion request").click());
    expect(mocks.deleteSave.mock.calls[1]![0]).toEqual(original);
    expect(container.textContent).toContain("Campaign deleted.");
    await act(async () => root.unmount()); root = createRoot(container);
    mocks.deletionStatus.mockResolvedValueOnce(statusResult("succeeded", "Campaign deleted."));
    await render(stopped, true);
    expect(container.textContent).toContain("Campaign deleted.");
    expect(mocks.deleteSave).toHaveBeenCalledTimes(2);
});

it("keeps an unavailable status pending and discards late responses after switching identity", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: freshId }));
    let finish!: (result: unknown) => void;
    mocks.deletionStatus.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(stopped, true);
    await act(async () => root.render(<ManagedServerCampaigns userId="other" serverId={serverId} status={stopped} canDelete />));
    await act(async () => finish(statusResult("succeeded", "Private old outcome")));
    expect(container.textContent).not.toContain("Private old outcome");
    await render(stopped, true);
    expect(container.textContent).toContain("Deletion status unavailable.");
    expect(button("New campaign").disabled).toBe(false);
    expect((container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.deleteSave).not.toHaveBeenCalled();
});

it("does not block campaign controls or new deletion after a previously confirmed terminal job is pruned", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: freshId, terminal: true }));
    await render(stopped, true);
    expect(container.textContent).toContain("Deletion status unavailable.");
    expect(button("New campaign").disabled).toBe(false);
    expect((container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.deleteSave).not.toHaveBeenCalled();
});

it("keeps corrupted storage fail closed for deletion without blocking refresh or selection", async () => {
    localStorage.setItem(deletionKey, "{broken");
    await render(stopped, true);
    expect(button("Refresh list").disabled).toBe(false);
    expect(button("Use this campaign").disabled).toBe(false);
    expect((container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.deleteSave).not.toHaveBeenCalled();
});

it("recovers a corrupt receipt only after confirmation and a fresh list, then completes an explicitly chosen deletion", async () => {
    localStorage.setItem(deletionKey, "{broken");
    vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "Imported Campaign"));
    await render(stopped, true);
    const readsBefore = mocks.list.mock.calls.length;
    expect(container.textContent).toContain("Status unknown");
    await act(async () => button("Check campaigns to recover").click());
    expect(mocks.list.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(mocks.deleteSave).not.toHaveBeenCalled();
    expect(localStorage.getItem(deletionKey)).toBeNull();
    mocks.deleteSave.mockResolvedValueOnce({ ok: true, jobId: freshId, message: "Queued" });
    mocks.deletionStatus.mockResolvedValueOnce(statusResult("succeeded", "Campaign deleted."));
    await act(async () => (container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain("Campaign deleted.");
    expect(mocks.deleteSave).toHaveBeenCalledTimes(1);
});

it("resolves an unknown receipt as deleted only when its save is absent from a fresh authorized list", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: freshId }));
    vi.stubGlobal("confirm", vi.fn(() => true));
    await render(stopped, true);
    mocks.list.mockResolvedValue({ ok: true, campaigns: { ...campaigns, items: [campaigns.items[0]] } });
    await act(async () => button("Check campaigns to recover").click());
    expect(container.textContent).toContain("Campaign deleted. It is no longer in the current campaign list.");
    expect(mocks.deleteSave).not.toHaveBeenCalled();
});

it("removes the retry offer when a second recovery confirms the campaign is gone", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: freshId }));
    vi.stubGlobal("confirm", vi.fn(() => true));
    await render(stopped, true);
    await act(async () => button("Check campaigns to recover").click());
    expect(button("Try again")).toBeTruthy();
    mocks.list.mockResolvedValue({ ok: true, campaigns: { ...campaigns, items: [campaigns.items[0]] } });
    await act(async () => button("Check campaigns to recover").click());
    expect(container.textContent).toContain("Campaign deleted.");
    expect(container.textContent).not.toContain("Try again");
    expect(mocks.deleteSave).not.toHaveBeenCalled();
});

it("clears an earlier retry candidate when beginning a new deletion", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: freshId, terminal: true }));
    vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "Imported Campaign"));
    await render(stopped, true);
    await act(async () => button("Check campaigns to recover").click());
    expect(button("Try again")).toBeTruthy();
    mocks.deleteSave.mockResolvedValueOnce({ ok: true, jobId: defaultId, message: "Queued" });
    await act(async () => (container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).click());
    expect(mocks.deleteSave).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Try again");
    expect(JSON.parse(localStorage.getItem(deletionKey)!).jobId).toBe(defaultId);
});

it("offers a fresh UUID only for an owner-confirmed retry after checking that the unknown save still exists", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: freshId }));
    vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "Imported Campaign"));
    await render(stopped, true);
    await act(async () => button("Check campaigns to recover").click());
    expect(mocks.deleteSave).not.toHaveBeenCalled();
    mocks.deleteSave.mockResolvedValueOnce({ ok: false, notSubmitted: false, message: "An operation is already active." });
    await act(async () => button("Try again").click());
    expect(mocks.deleteSave).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSave.mock.calls[0]![0]).toMatchObject({ ...retainedInput, requestId: expect.any(String) });
    expect(mocks.deleteSave.mock.calls[0]![0].requestId).not.toBe(retainedInput.requestId);
    expect(container.textContent).toContain("An operation is already active.");
    expect(JSON.parse(localStorage.getItem(deletionKey)!).previous).toMatchObject({ input: retainedInput, jobId: freshId });
    // An ambiguous refusal retains both identities across refresh. A later definitive
    // refusal restores the accepted job instead of losing its durable outcome.
    await act(async () => root.unmount()); root = createRoot(container);
    await render(stopped, true);
    const retryInput = mocks.deleteSave.mock.calls[0]![0];
    mocks.deleteSave.mockResolvedValueOnce({ ok: false, notSubmitted: true, message: "Safe stop required." });
    mocks.deletionStatus.mockResolvedValueOnce(statusResult("succeeded", "Original campaign deleted."));
    await act(async () => button("Recover deletion request").click());
    expect(mocks.deleteSave.mock.calls[1]![0]).toEqual(retryInput);
    expect(JSON.parse(localStorage.getItem(deletionKey)!).jobId).toBe(freshId);
    expect(container.textContent).toContain("Original campaign deleted.");
});

it("checks campaigns on the first recovery click after an accepted deletion in this tab", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "Imported Campaign"));
    mocks.deleteSave.mockResolvedValueOnce({ ok: true, jobId: freshId, message: "Queued" });
    await render(stopped, true);
    await act(async () => (container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).click());
    const readsBefore = mocks.list.mock.calls.length;
    await act(async () => button("Check campaigns to recover").click());
    expect(mocks.list.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(button("Try again")).toBeTruthy();
    expect(container.textContent).not.toContain("Another deletion request");
    expect(mocks.deleteSave).toHaveBeenCalledTimes(1);
});

it("restores the accepted receipt when a fresh retry is definitively refused", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: freshId }));
    vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "Imported Campaign"));
    await render(stopped, true);
    await act(async () => button("Check campaigns to recover").click());
    mocks.deleteSave.mockResolvedValueOnce({ ok: false, notSubmitted: true, message: "Safe stop required." });
    await act(async () => button("Try again").click());
    expect(JSON.parse(localStorage.getItem(deletionKey)!)).toMatchObject({ input: retainedInput, jobId: freshId });
    expect(mocks.deletionStatus).toHaveBeenLastCalledWith(serverId, freshId, "owner");
});

it.each(["corrupt", "old target absent"])("adopts a valid receipt saved before recovery begins (%s)", async (initial) => {
    localStorage.setItem(deletionKey, initial === "corrupt" ? "{broken" : JSON.stringify({ input: { ...retainedInput, saveId: freshId }, jobId: freshId }));
    vi.stubGlobal("confirm", vi.fn(() => true));
    await render(stopped, true);
    const newer = { input: { ...retainedInput, requestId: defaultId }, jobId: importedId };
    localStorage.setItem(deletionKey, JSON.stringify(newer));
    mocks.deletionStatus.mockResolvedValueOnce({ ...statusResult("running", "Newer deletion running"), status: { ...statusResult("running", "").status, jobId: importedId } });
    await act(async () => button("Check campaigns to recover").click());
    expect(JSON.parse(localStorage.getItem(deletionKey)!)).toEqual(newer);
    expect(mocks.deletionStatus).toHaveBeenLastCalledWith(serverId, importedId, "owner");
    expect(container.textContent).toContain("Newer deletion running");
    expect(mocks.deleteSave).not.toHaveBeenCalled();
});

it("keeps an unknown receipt when fresh access is denied and never resubmits automatically", async () => {
    localStorage.setItem(deletionKey, "{broken");
    vi.stubGlobal("confirm", vi.fn(() => true));
    await render(stopped, true);
    mocks.list.mockResolvedValueOnce({ ok: false, message: "Access denied" });
    await act(async () => button("Check campaigns to recover").click());
    expect(localStorage.getItem(deletionKey)).toBe("{broken");
    expect(container.textContent).toContain("Status unknown");
    expect(mocks.deleteSave).not.toHaveBeenCalled();
});

it("clears a definite pre-admission refusal so another campaign request can be sent", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "Imported Campaign"));
    mocks.deleteSave.mockResolvedValueOnce({ ok: false, notSubmitted: true, message: "Campaign no longer exists." });
    await render(stopped, true);
    await act(async () => (container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).click());
    expect(localStorage.getItem(deletionKey)).toBeNull();
    expect((container.querySelector('[aria-label="Delete Imported Campaign"]') as HTMLButtonElement).disabled).toBe(false);
});

it("adopts a newer cross-tab receipt instead of repeatedly recovering an overwritten request", async () => {
    localStorage.setItem(deletionKey, JSON.stringify({ input: retainedInput, jobId: null }));
    mocks.deleteSave.mockImplementationOnce(async () => {
        localStorage.setItem(deletionKey, JSON.stringify({ input: { ...retainedInput, requestId: defaultId }, jobId: freshId }));
        return { ok: true, jobId: importedId, message: "Queued" };
    });
    mocks.deletionStatus.mockResolvedValueOnce(statusResult("running", "Checking newer job"));
    await render(stopped, true);
    await act(async () => button("Recover deletion request").click());
    expect(container.textContent).toContain("Checking newer job");
    expect(mocks.deleteSave).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(deletionKey)!).input.requestId).toBe(defaultId);
});
