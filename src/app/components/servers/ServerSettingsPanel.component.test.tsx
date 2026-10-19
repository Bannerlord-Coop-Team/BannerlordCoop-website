import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerSettingsPanel } from "./ServerSettingsPanel";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, settings: vi.fn(), visibility: vi.fn(), release: vi.fn(), status: vi.fn(), rename: vi.fn(), manager: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/app/servers/server-settings-actions", () => ({ saveServerSettings: mocks.settings }));
vi.mock("@/app/servers/server-visibility-actions", () => ({ setServerVisibility: mocks.visibility }));
vi.mock("@/app/servers/server-release-actions", () => ({ changeServerRelease: mocks.release, readServerReleaseStatus: mocks.status }));
vi.mock("@/app/servers/name-actions", () => ({ renameLiveServer: mocks.rename }));
vi.mock("@/app/servers/server-manager-actions", () => ({ setServerManager: mocks.manager }));

const serverId = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-10-01T00:00:00.000Z";
const savedAt = "2026-10-01T00:00:01.000Z";
const visibilityAt = "2026-10-01T00:00:02.000Z";
const access = { serverId, expectedUpdatedAt: updatedAt, canEdit: true };
const props: ComponentProps<typeof ServerSettingsPanel> = {
    name: "Settings QA", visibility: "private", visibilityAccess: access,
    releaseAccess: { ...access, channel: "stable" },
    settingsAccess: { ...access, maintenanceSlot: "06:00-07:00", timezone: "America/Chicago" },
    managerAccess: { serverId, expectedUpdatedAt: updatedAt, canEdit: true },
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
    mocks.manager.mockResolvedValue({ ok: true, message: "Manager access granted." });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function render(next = props) { await act(async () => root.render(<TestLocalization>{<ServerSettingsPanel {...next} />} </TestLocalization>)); }
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
    expect(container.querySelector<HTMLSelectElement>("#settings-maintenance-window")!.value).toBe("06:00-07:00");
    expect(container.querySelectorAll("#settings-maintenance-window option")).toHaveLength(3);
    expect(container.textContent).toContain("America/Chicago");
    expect(container.textContent).not.toContain("Nightly is experimental.");
    expect(container.querySelector("#config-json")).toBeNull();
    await change("#settings-maintenance-window", "10:00-11:00");
    expect(container.textContent).toContain("Unsaved changes");
    expect(mocks.settings).not.toHaveBeenCalled();
    await click("Discard");
    expect(container.querySelector<HTMLSelectElement>("#settings-maintenance-window")!.value).toBe("06:00-07:00");
    expect(container.textContent).toContain("No pending changes");
});

it("filters the settings controls by their labels and shows an empty state when nothing matches", async () => {
    await render();
    await change("#settings-search", "visibility");
    expect(container.querySelector("#settings-server-name")).toBeNull();
    expect(container.querySelector("#settings-maintenance-window")).toBeNull();
    expect(container.querySelector("#settings-release-channel")).toBeNull();
    expect(container.querySelector('input[name="settings-visibility"]')).not.toBeNull();
    await change("#settings-search", "does not exist");
    expect(container.querySelector('input[name="settings-visibility"]')).toBeNull();
    expect(container.textContent).toContain("No settings match your search.");
});

it("offers owner manager access through exact email entry without rendering an account directory", async () => {
    await render();
    expect(container.textContent).toContain("Bannerlord Coop account email");
    expect(container.querySelector("datalist")).toBeNull();
    expect(container.querySelectorAll('input[type="email"]')).toHaveLength(1);
    await change("#manager-account-email", "friend@example.com");
    await act(async () => container.querySelector<HTMLFormElement>('form:has(#manager-account-email)')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.manager).toHaveBeenCalledExactlyOnceWith(expect.any(FormData));
    const submitted = mocks.manager.mock.calls[0]![0] as FormData;
    expect(submitted.get("serverId")).toBe(serverId);
    expect(submitted.get("expectedUpdatedAt")).toBe(updatedAt);
    expect(submitted.get("managerEmail")).toBe("friend@example.com");
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
        patch: { displayName: "Renamed QA", maintenanceSlot: "18:00-19:00" }, requestId: expect.any(String),
        previous: { displayName: "Settings QA", maintenanceSlot: "06:00-07:00" } });
    expect(mocks.visibility).toHaveBeenCalledWith({ serverId, visibility: "public", expectedUpdatedAt: savedAt, requestId: expect.any(String) });
    expect(mocks.release).toHaveBeenCalledWith({ serverId, releaseChannel: "nightly", expectedUpdatedAt: visibilityAt, requestId: expect.any(String), previousChannel: "stable" });
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

it("explains an invalid server name beside the field before contacting the server", async () => {
    await render();
    const name = () => container.querySelector<HTMLInputElement>("#settings-server-name")!;
    await change("#settings-server-name", "ab");
    await submit();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(name().getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("#settings-server-name-error")?.textContent).toBe("Server names need at least 3 characters.");
    expect(name().getAttribute("aria-describedby")).toContain("settings-server-name-error");
    expect(document.activeElement).toBe(name());
    await change("#settings-server-name", "Bad <name>");
    expect(container.querySelector("#settings-server-name-error")?.textContent).toContain("Use only letters, numbers, spaces");
    await change("#settings-server-name", "Valid QA name");
    expect(container.querySelector("#settings-server-name-error")).toBeNull();
    expect(name().getAttribute("aria-invalid")).toBeNull();
    await submit();
    expect(mocks.settings).toHaveBeenCalledOnce();
});

it("applies the live rename rules to live server names", async () => {
    await render({ name: "Live", renameServerId: "live-server" });
    await change("#settings-server-name", "   ");
    await submit();
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(container.querySelector("#settings-server-name-error")?.textContent).toBe("Enter a server name.");
});

it.each([
    ["displayName", "#settings-server-name", "Server names can have at most 48 characters."],
    ["maintenanceSlot", "#settings-maintenance-window", "Choose one of the listed maintenance windows."],
] as const)("shows a server rejection of %s under that field and clears Saving at once", async (field, selector, message) => {
    mocks.settings.mockResolvedValue({ ok: false, rejected: true, field, message });
    await render();
    await change("#settings-maintenance-window", "10:00-11:00");
    await submit();
    const control = container.querySelector(selector)!;
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const error = document.getElementById(control.getAttribute("aria-describedby")!.split(" ")[0])!;
    expect(error.textContent).toBe(message);
    expect(container.querySelector("[data-unsaved-bar]")!.textContent).not.toContain(message);
    expect(Array.from(container.querySelectorAll("button")).find(button => button.type === "submit")!.textContent).toBe("Save settings");
});

it("pins the save bar to the viewport only while there are unsaved changes", async () => {
    await render();
    expect(container.querySelector("[data-unsaved-bar]")).toBeNull();
    await change("#settings-maintenance-window", "18:00-19:00");
    const bar = container.querySelector("[data-unsaved-bar]")!;
    expect(bar.getAttribute("data-unsaved-bar")).toBe("pinned");
    expect(bar.className).toContain("fixed");
    expect(bar.textContent).toContain("Save settings");
    await click("Discard");
    expect(container.querySelector("[data-unsaved-bar]")).toBeNull();
});

it.each([
    ["no update job", null],
    ["an update that finished before the page loaded", { jobId: "22222222-2222-4222-8222-222222222222", state: "succeeded", progress: "Done." }],
] as const)("does not re-render the page when its first release check finds %s", async (_case, job) => {
    mocks.status.mockResolvedValue({ serverId, releaseChannel: "stable", job });
    await render();
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith(serverId);
    expect(mocks.router.refresh).not.toHaveBeenCalled();
});

it("re-renders the page when the channel moved since it rendered", async () => {
    mocks.status.mockResolvedValue({ serverId, releaseChannel: "nightly", job: null });
    await render();
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
});

it("re-renders the page when a release change it requested finishes before any check sees it run", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const jobId = "22222222-2222-4222-8222-222222222222";
    mocks.status.mockResolvedValue({ serverId, releaseChannel: "stable", job: null });
    await render();
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    mocks.release.mockResolvedValue({ ok: true, jobId, message: "Release queued." });
    mocks.status.mockResolvedValue({ serverId, releaseChannel: "stable", job: { jobId, state: "failed", progress: "Failed." } });
    await change("#settings-release-channel", "nightly");
    await submit();
    // The accepted save refreshes once; the requested job's quick failure refreshes again.
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
});

it("re-renders the page once after an update it followed finishes", async () => {
    vi.useFakeTimers();
    try {
        const jobId = "22222222-2222-4222-8222-222222222222";
        mocks.status.mockResolvedValue({ serverId, releaseChannel: "stable", job: { jobId, state: "running", progress: "Updating." } });
        await render();
        await act(async () => vi.advanceTimersByTimeAsync(4_000));
        expect(mocks.status).toHaveBeenCalledTimes(2);
        expect(mocks.router.refresh).not.toHaveBeenCalled();
        mocks.status.mockResolvedValue({ serverId, releaseChannel: "nightly", job: { jobId, state: "succeeded", progress: "Done." } });
        await act(async () => vi.advanceTimersByTimeAsync(4_000));
        expect(mocks.router.refresh).toHaveBeenCalledOnce();
        // The refresh delivers the new channel; it must not start another release check.
        await render({ ...props, releaseAccess: { ...props.releaseAccess!, channel: "nightly" } });
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(mocks.status).toHaveBeenCalledTimes(3);
        expect(mocks.router.refresh).toHaveBeenCalledOnce();
    } finally {
        vi.useRealTimers();
    }
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
