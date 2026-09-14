import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerVisibilitySetting } from "./ServerVisibilitySetting";
const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/servers/server-visibility-actions", () => ({ setServerVisibility: mocks.update }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
let container: HTMLDivElement;
let root: Root;
const props = { serverId: "aaaaaaaa-1111-4111-8111-111111111111", accessRole: "owner" as const, expectedUpdatedAt: "2026-09-10T00:00:00.000Z" };
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    mocks.update.mockReset(); mocks.refresh.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it("defaults missing visibility to private and requires explicit publishing confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => root.render(<ServerVisibilitySetting {...props} />));
    expect(container.querySelector("summary")?.textContent).toContain("Private");
    expect(container.textContent).toContain("Public listing is not available yet");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
    expect(confirm).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    mocks.update.mockResolvedValue({ ok: true, message: "Published" });
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ serverId: props.serverId, visibility: "public", expectedUpdatedAt: props.expectedUpdatedAt, requestId: expect.any(String) }));
    expect(mocks.refresh).toHaveBeenCalled();
});
it.each(["throw", "error"] as const)("retries the identical UUID and input after an uncertain %s response", async failure => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    if (failure === "throw") mocks.update.mockRejectedValueOnce(new Error("Network lost"));
    else mocks.update.mockResolvedValueOnce({ ok: false, message: "Response could not be confirmed" });
    mocks.update.mockResolvedValueOnce({ ok: true, message: "Update acknowledged" });
    await act(async () => root.render(<ServerVisibilitySetting {...props} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
    const first = mocks.update.mock.calls[0][0];
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
    expect(mocks.update.mock.calls[1][0]).toEqual(first);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector("summary")?.textContent).toContain("Private");
});
it("uses a new request after an authoritative generation change", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.update.mockResolvedValue({ ok: false, message: "Refresh required" });
    await act(async () => root.render(<ServerVisibilitySetting {...props} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
    const first = mocks.update.mock.calls[0][0];
    const expectedUpdatedAt = "2026-09-13T12:00:00.000Z";
    await act(async () => root.render(<ServerVisibilitySetting {...props} expectedUpdatedAt={expectedUpdatedAt} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
    expect(mocks.update.mock.calls[1][0].requestId).not.toBe(first.requestId);
    expect(mocks.update.mock.calls[1][0].expectedUpdatedAt).toBe(expectedUpdatedAt);
});
it.each(["manager", "support", "admin"] as const)("%s cannot publish or hide a server", async accessRole => {
    await act(async () => root.render(<ServerVisibilitySetting {...props} accessRole={accessRole} visibility="public" />));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Only the server owner");
});
it("can make public server private and reports a stale failure without optimistic success", async () => {
    mocks.update.mockResolvedValue({ ok: false, message: "The server changed. Refresh and try again." });
    await act(async () => root.render(<ServerVisibilitySetting {...props} visibility="public" />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("The server changed");
    expect(container.querySelector("summary")?.textContent).toContain("Public");
});

it("shows the selected choice and closes the picker with Escape", async () => {
    await act(async () => root.render(<ServerVisibilitySetting {...props} />));
    const picker = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("Private");
    picker.open = true;
    await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(picker.open).toBe(false);
    expect(document.activeElement).toBe(summary);
});
