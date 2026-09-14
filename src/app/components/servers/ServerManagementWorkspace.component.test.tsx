import { ServerSettingsPanel } from "./ServerSettingsPanel";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerManagementWorkspace, ServerWorkspacePanel, ServerConsoleWorkspace, UnavailableServerConsole, UnavailableServerPanel } from "./ServerManagementWorkspace";

const settingsMocks = vi.hoisted(() => ({ rename: vi.fn(), visibility: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: settingsMocks.refresh }) }));
vi.mock("@/app/servers/name-actions", () => ({ renameLiveServer: settingsMocks.rename }));
vi.mock("@/app/servers/server-visibility-actions", () => ({ setServerVisibility: settingsMocks.visibility }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    settingsMocks.rename.mockReset(); settingsMocks.visibility.mockReset(); settingsMocks.refresh.mockReset();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.history.replaceState(null, "", "/servers/test");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
function click(label: string) {
    const target = [...container.querySelectorAll("button")].find(button => button.textContent === label)!;
    target.click();
}

it("switches all four workspaces without unmounting live controls or losing drafts", async () => {
    const disconnected = vi.fn();
    function Console() {
        useEffect(() => () => disconnected(), []);
        const [draft, setDraft] = useState(0);
        return <button onClick={() => setDraft(draft + 1)}>Draft {draft}</button>;
    }
    await act(async () => root.render(<ServerManagementWorkspace name={<h1>Real server</h1>} summary="Running" status={<div id="server-status">Game state: Running · Lifecycle: Running · Release channel: Stable</div>} notice="Live controls">
        <ServerWorkspacePanel section="Console"><Console /></ServerWorkspacePanel>
        <ServerWorkspacePanel section="Backups"><div id="backup-content">Real backups</div></ServerWorkspacePanel>
        <ServerWorkspacePanel section="Save & config"><div id="file-content">Real transfers</div></ServerWorkspacePanel>
        <ServerWorkspacePanel section="Settings"><div id="settings-content">Access manager</div></ServerWorkspacePanel>
    </ServerManagementWorkspace>));
    await act(async () => click("Draft 0"));
    for (const [tab, id] of [["Backups", "backup-content"], ["Save & config", "file-content"], ["Settings", "settings-content"]]) {
        await act(async () => click(tab));
        expect(container.querySelector(`#${id}`)?.closest("[hidden]")).toBeNull();
        expect(container.querySelector("header #server-status")).not.toBeNull();
        expect(container.querySelector("#server-status")?.closest("[hidden]")).toBeNull();
        expect([...container.querySelectorAll("button")].find(b => b.textContent === "Draft 1")?.closest("[hidden]")).not.toBeNull();
    }
    await act(async () => click("Console"));
    expect(container.textContent).toContain("Draft 1");
    expect(disconnected).not.toHaveBeenCalled();
});

it("hides the real address until revealed and copies it without navigation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => root.render(<ServerManagementWorkspace name="Real server" address="203.0.113.8:7210" summary="Running" notice="Live controls">Content</ServerManagementWorkspace>));
    expect(container.textContent).not.toContain("203.0.113.8");
    await act(async () => click("Copy join address"));
    expect(writeText).toHaveBeenCalledWith("203.0.113.8:7210");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-controls="server-address"]')!.click());
    expect(container.querySelector("#server-address")?.textContent).toBe("203.0.113.8:7210");
});

it("opens access feedback and hash targets in Settings and disables unsupported actions", async () => {
    await act(async () => root.render(<ServerManagementWorkspace name="Server" summary="Unknown" notice="Unavailable" initialSection="Settings">
        <ServerWorkspacePanel section="Settings"><UnavailableServerPanel title="Visibility" actions={["Public"]} /></ServerWorkspacePanel>
    </ServerManagementWorkspace>));
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Settings");
    expect([...container.querySelectorAll("button")].find(b => b.textContent === "Public")?.disabled).toBe(true);
    expect([...container.querySelectorAll("button")].find(b => b.textContent === "Copy join address")?.disabled).toBe(true);
    await act(async () => click("Console"));
    await act(async () => { window.location.hash = "server-access"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Settings");
});

it("renders the wireframe console with all unconnected features disabled", async () => {
    await act(async () => root.render(<ServerConsoleWorkspace><UnavailableServerConsole /></ServerConsoleWorkspace>));
    expect(container.querySelector('[role="log"]')?.textContent).toContain("not connected");
    expect(container.textContent).toContain("Information");
    expect(container.textContent).toContain("Campaign");
    for (const control of container.querySelectorAll("button, input")) {
        expect((control as HTMLButtonElement).disabled).toBe(true);
    }
});

it("keeps supplied real lifecycle controls enabled while console input stays unavailable", async () => {
    const start = vi.fn();
    await act(async () => root.render(<UnavailableServerConsole controls={<button onClick={start}>Start</button>} />));
    await act(async () => click("Start"));
    expect(start).toHaveBeenCalledOnce();
    expect(container.querySelector("input")?.disabled).toBe(true);
});

it("shows authoritative settings without enabling unsupported save controls", async () => {
    await act(async () => root.render(<ServerSettingsPanel name="Real campaign" visibility="public" />));
    expect(container.querySelector<HTMLInputElement>("#settings-server-name")?.value).toBe("Real campaign");
    expect(container.querySelector<HTMLInputElement>('input[value="public"]')?.checked).toBe(true);
    for (const control of container.querySelectorAll("input, button")) expect((control as HTMLInputElement).disabled).toBe(true);
    await act(async () => root.render(<ServerSettingsPanel name="Renamed campaign" />));
    expect(container.querySelector<HTMLInputElement>("#settings-server-name")?.value).toBe("Renamed campaign");
    expect(container.querySelector('input[type="radio"]:checked')).toBeNull();
    expect(container.textContent).toContain("Directory visibility is unavailable");
});

const visibilityAccess = { serverId: "managed-server", expectedUpdatedAt: "2026-09-13T00:00:00.000Z", canEdit: true };
async function renameDraft(value: string) {
    const input = container.querySelector<HTMLInputElement>("#settings-server-name")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
async function saveSettings() {
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
it("discards local settings drafts without calling either server action", async () => {
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="private" renameServerId="live-server" visibilityAccess={visibilityAccess} />));
    await renameDraft("New campaign");
    await act(async () => container.querySelector<HTMLInputElement>('input[value="public"]')!.click());
    await act(async () => click("Discard"));
    expect(container.querySelector<HTMLInputElement>("#settings-server-name")!.value).toBe("Campaign");
    expect(container.querySelector<HTMLInputElement>('input[value="private"]')!.checked).toBe(true);
    expect(settingsMocks.rename).not.toHaveBeenCalled();
    expect(settingsMocks.visibility).not.toHaveBeenCalled();
});
it("confirms publishing before saving, retains partial failures and retries the same visibility request", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    settingsMocks.rename.mockResolvedValue({ ok: true, displayName: "New campaign" });
    settingsMocks.visibility.mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce({ ok: true, message: "Update acknowledged" });
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="private" renameServerId="live-server" visibilityAccess={visibilityAccess} />));
    await renameDraft("New campaign");
    await act(async () => container.querySelector<HTMLInputElement>('input[value="public"]')!.click());
    await saveSettings();
    expect(settingsMocks.rename).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await saveSettings();
    expect(settingsMocks.rename.mock.calls[0][0].get("displayName")).toBe("New campaign");
    expect(settingsMocks.rename.mock.calls[0][0].get("serverId")).toBe("live-server");
    const first = settingsMocks.visibility.mock.calls[0][0];
    expect(first).toEqual(expect.objectContaining({ serverId: "managed-server", visibility: "public", expectedUpdatedAt: visibilityAccess.expectedUpdatedAt, requestId: expect.any(String) }));
    expect(container.textContent).toContain("Server name saved.");
    expect(container.textContent).toContain("could not be confirmed");
    await saveSettings();
    expect(settingsMocks.rename).toHaveBeenCalledOnce();
    expect(settingsMocks.visibility.mock.calls[1][0]).toEqual(first);
    expect(settingsMocks.refresh).toHaveBeenCalled();
});
it("saves a managed owner's visibility without attempting unsupported renaming", async () => {
    settingsMocks.visibility.mockResolvedValue({ ok: true, message: "Update acknowledged" });
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="public" visibilityAccess={visibilityAccess} />));
    expect(container.querySelector<HTMLInputElement>("#settings-server-name")!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('input[value="private"]')!.click());
    await saveSettings();
    expect(settingsMocks.visibility).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }));
    expect(settingsMocks.rename).not.toHaveBeenCalled();
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="private" visibilityAccess={{ ...visibilityAccess, expectedUpdatedAt: "2026-09-14T00:00:00.000Z" }} />));
    expect(container.textContent).toContain("No pending changes");
});
