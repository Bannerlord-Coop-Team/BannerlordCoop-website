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
    expect(container.textContent).toContain("Server visibility: Private");
    await act(async () => container.querySelector("button")!.click());
    expect(confirm).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    mocks.update.mockResolvedValue({ ok: true, message: "Published" });
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ serverId: props.serverId, visibility: "public", expectedUpdatedAt: props.expectedUpdatedAt, requestId: expect.any(String) }));
    expect(mocks.refresh).toHaveBeenCalled();
});
it.each(["manager", "support", "admin"] as const)("%s cannot publish or hide a server", async accessRole => {
    await act(async () => root.render(<ServerVisibilitySetting {...props} accessRole={accessRole} visibility="public" />));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Only the server owner");
});
it("can make public server private and reports a stale failure without optimistic success", async () => {
    mocks.update.mockResolvedValue({ ok: false, message: "The server changed. Refresh and try again." });
    await act(async () => root.render(<ServerVisibilitySetting {...props} visibility="public" />));
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("The server changed");
    expect(container.textContent).toContain("Server visibility: Public");
});
