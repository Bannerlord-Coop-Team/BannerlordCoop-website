import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerSettingsPanel } from "./ServerSettingsPanel";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, settings: vi.fn(), visibility: vi.fn(), release: vi.fn(), status: vi.fn(), rename: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/app/servers/server-settings-actions", () => ({ saveServerSettings: mocks.settings }));
vi.mock("@/app/servers/server-visibility-actions", () => ({ setServerVisibility: mocks.visibility }));
vi.mock("@/app/servers/server-release-actions", () => ({ changeServerRelease: mocks.release, readServerReleaseStatus: mocks.status }));
vi.mock("@/app/servers/name-actions", () => ({ renameLiveServer: mocks.rename }));

const serverId = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-10-01T00:00:00.000Z";
const savedAt = "2026-10-01T00:00:01.000Z";
const visibilityAt = "2026-10-01T00:00:02.000Z";
const access = { serverId, expectedUpdatedAt: updatedAt, canEdit: true };
const props: ComponentProps<typeof ServerSettingsPanel> = {
    name: "Settings QA", visibility: "private", visibilityAccess: access,
    releaseAccess: { ...access, channel: "stable" },
    settingsAccess: { ...access, maintenanceSlot: "03:00-04:00", timezone: "America/Chicago" },
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.resetAllMocks();
    mocks.settings.mockResolvedValue({ ok: true, updatedAt: savedAt, message: "Server settings saved." });
    mocks.visibility.mockResolvedValue({ ok: true, updatedAt: visibilityAt, message: "Visibility saved." });
    mocks.release.mockResolvedValue({ ok: true, jobId: serverId, message: "Release queued." });
    mocks.status.mockResolvedValue(null);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function render(next = props) { await act(async () => root.render(<ServerSettingsPanel {...next} />)); }
async function change(selector: string, value: string) {
    await act(async () => {
        const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
        const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event(element instanceof HTMLInputElement ? "input" : "change", { bubbles: true }));
    });
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
function click(text: string) { return act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === text)!.click()); }

it("renders current maintenance preferences and discards unsaved changes without writes", async () => {
    await render();
    expect(container.querySelector<HTMLSelectElement>("#settings-maintenance-window")!.value).toBe("03:00-04:00");
    expect(container.querySelectorAll("#settings-maintenance-window option")).toHaveLength(3);
    expect(container.textContent).toContain("America/Chicago");
    expect(container.textContent).not.toContain("Nightly is experimental.");
    expect(container.querySelector("#config-json")).toBeNull();
    await change("#settings-maintenance-window", "10:00-11:00");
    expect(container.textContent).toContain("Unsaved changes");
    expect(mocks.settings).not.toHaveBeenCalled();
    await click("Discard");
    expect(container.querySelector<HTMLSelectElement>("#settings-maintenance-window")!.value).toBe("03:00-04:00");
    expect(container.textContent).toContain("No pending changes");
});

it("saves name and maintenance once, then carries each returned generation into visibility and release", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await render();
    await change("#settings-server-name", "Renamed QA");
    await change("#settings-maintenance-window", "18:00-19:00");
    await act(async () => container.querySelector<HTMLInputElement>('input[value="public"]')!.click());
    await change("#settings-release-channel", "nightly");
    await submit();
    expect(mocks.settings).toHaveBeenCalledExactlyOnceWith({ serverId, expectedUpdatedAt: updatedAt,
        patch: { displayName: "Renamed QA", maintenanceSlot: "18:00-19:00" }, requestId: expect.any(String) });
    expect(mocks.visibility).toHaveBeenCalledWith({ serverId, visibility: "public", expectedUpdatedAt: savedAt, requestId: expect.any(String) });
    expect(mocks.release).toHaveBeenCalledWith({ serverId, releaseChannel: "nightly", expectedUpdatedAt: visibilityAt, requestId: expect.any(String) });
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.router.refresh).toHaveBeenCalled();
});

it("reuses an uncertain settings request and reloads the saved preference", async () => {
    mocks.settings.mockResolvedValueOnce({ ok: false, message: "Could not confirm." });
    await render(); await change("#settings-maintenance-window", "10:00-11:00"); await submit();
    const request = mocks.settings.mock.calls[0][0];
    expect(container.textContent).toContain("Could not confirm.");
    await submit();
    expect(mocks.settings.mock.calls[1][0]).toEqual(request);
    await render({ ...props, settingsAccess: { ...props.settingsAccess!, maintenanceSlot: "10:00-11:00", expectedUpdatedAt: savedAt } });
    expect(container.textContent).toContain("No pending changes");
    expect(container.querySelector<HTMLSelectElement>("#settings-maintenance-window")!.value).toBe("10:00-11:00");
});

it("halts the save sequence on a rejected stale preference", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.settings.mockResolvedValue({ ok: false, rejected: true, message: "The server changed." });
    await render(); await change("#settings-maintenance-window", "10:00-11:00");
    await act(async () => container.querySelector<HTMLInputElement>('input[value="public"]')!.click());
    await submit();
    expect(mocks.visibility).not.toHaveBeenCalled(); expect(mocks.release).not.toHaveBeenCalled();
    expect(container.textContent).toContain("The server changed.");
});

it.each([false, true])("disables maintenance when owner access or stored preferences are unavailable (%s)", async missing => {
    await render({ ...props, settingsAccess: { ...props.settingsAccess!, canEdit: missing, ...(missing ? { maintenanceSlot: undefined, timezone: undefined } : {}) } });
    expect(container.querySelector<HTMLSelectElement>("#settings-maintenance-window")!.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#settings-server-name")!.disabled).toBe(true);
    expect(mocks.settings).not.toHaveBeenCalled();
});
