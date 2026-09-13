import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerManagementWorkspace, ServerWorkspacePanel, UnavailableServerPanel } from "./ServerManagementWorkspace";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
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
