import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestLocalization } from "./ManagedServerLocalization.test-utils";
import { ManagedServerDelete } from "./ManagedServerDelete";
const mocks = vi.hoisted(() => ({ remove: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/servers/server-deletion-actions", () => ({ deleteManagedServer: mocks.remove }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const props = { serverId: "aaaaaaaa-1111-4111-8111-111111111111", displayName: "The Northern March", accessRole: "owner", operationState: "running", expectedUpdatedAt: "2026-10-07T12:00:00.000Z" };
let container: HTMLDivElement, root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    mocks.remove.mockReset(); mocks.refresh.mockReset();
    mocks.remove.mockResolvedValue({ ok: true, message: "Deletion requested. Removal is pending." });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function render(overrides = {}) { await act(async () => root.render(<TestLocalization><ManagedServerDelete {...props} {...overrides} /></TestLocalization>)); }
function button(text: string) { return [...container.querySelectorAll("button")].find(element => element.textContent === text)!; }
async function click(text: string) { await act(async () => button(text).click()); }
async function type(text: string) {
    const input = container.querySelector<HTMLInputElement>("#delete-server-name")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function acknowledge() { await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); }
async function openConfirmed() { await render(); await click("Delete server…"); await type(props.displayName); await acknowledge(); }

it("requires the exact name and acknowledgement even when the form is submitted directly", async () => {
    await render(); await click("Delete server…");
    expect(document.activeElement).toBe(button("Cancel"));
    expect(button("Permanently delete server").disabled).toBe(true);
    await type("the northern march"); await acknowledge();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.remove).not.toHaveBeenCalled();
    await type(props.displayName); await acknowledge();
    expect(button("Permanently delete server").disabled).toBe(true);
    await acknowledge(); await click("Permanently delete server");
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ serverId: props.serverId, confirmationText: props.displayName, expectedUpdatedAt: props.expectedUpdatedAt, requestId: expect.any(String) });
    expect(container.textContent).toContain("Removal is pending");
    expect(button("Delete server…").disabled).toBe(true);
});
it("cancels with Escape and restores focus without submitting", async () => {
    await render(); const trigger = button("Delete server…"); await click("Delete server…");
    await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(container.querySelector("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger); expect(mocks.remove).not.toHaveBeenCalled();
});
it.each(["manager", "support", "admin"])("hides deletion from %s", async accessRole => {
    await render({ accessRole }); expect(container.querySelector("button")).toBeNull();
});
it("invalidates an open confirmation when the server revision changes", async () => {
    await openConfirmed(); await render({ expectedUpdatedAt: "2026-10-07T12:00:01.000Z" });
    expect(button("Permanently delete server").disabled).toBe(true);
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.remove).not.toHaveBeenCalled();
});
it("prevents duplicate submissions while pending", async () => {
    let resolve!: (value: { ok: boolean; message: string }) => void;
    mocks.remove.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await openConfirmed(); await click("Permanently delete server");
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(mocks.remove).toHaveBeenCalledTimes(1); expect(container.querySelector("dialog")).not.toBeNull();
    await act(async () => resolve({ ok: true, message: "Queued" }));
});
it("retains an uncertain request across close, reopen and revision changes", async () => {
    mocks.remove.mockRejectedValueOnce(new Error("lost after commit"));
    await openConfirmed(); await click("Permanently delete server");
    const original = mocks.remove.mock.calls[0][0]; expect(mocks.refresh).not.toHaveBeenCalled();
    await click("Cancel"); await render({ operationState: "deleting", expectedUpdatedAt: "2026-10-07T12:00:01.000Z" });
    await click("Delete server…"); await type(props.displayName); await acknowledge(); await click("Retry confirmed deletion");
    expect(mocks.remove.mock.calls[1][0]).toEqual(original); expect(mocks.refresh).toHaveBeenCalledOnce();
});
it("requires a new confirmation after a known rejection", async () => {
    mocks.remove.mockResolvedValueOnce({ ok: false, rejected: true, message: "The server changed" });
    await openConfirmed(); await click("Permanently delete server"); const original = mocks.remove.mock.calls[0][0];
    await click("Cancel"); await render({ expectedUpdatedAt: "2026-10-07T12:00:01.000Z", displayName: "Renamed server" });
    await click("Delete server…"); expect(button("Permanently delete server").disabled).toBe(true);
    await type("Renamed server"); await acknowledge(); await click("Permanently delete server");
    expect(mocks.remove.mock.calls[1][0]).toMatchObject({ confirmationText: "Renamed server", expectedUpdatedAt: "2026-10-07T12:00:01.000Z" });
    expect(mocks.remove.mock.calls[1][0].requestId).not.toBe(original.requestId);
});
it("shows the durable deletion progress after returning to the page", async () => {
    await render({
        operationState: "deletion-pending",
        deletionStatus: {
            serverId: props.serverId,
            updatedAt: props.expectedUpdatedAt,
            operationState: "deletion-pending",
            job: {
                jobId: "bbbbbbbb-1111-4111-8111-111111111111",
                state: "running",
                progress: "Removing the hosted server safely",
                createdAt: props.expectedUpdatedAt,
                updatedAt: props.expectedUpdatedAt,
            },
        },
    });
    expect(container.textContent).toContain("Deletion status: Removing the hosted server safely");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
});
