import { ServerSettingsPanel } from "./ServerSettingsPanel";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerManagementWorkspace, ServerWorkspacePanel, ServerConsoleWorkspace, UnavailableServerConsole, UnavailableServerPanel } from "./ServerManagementWorkspace";

const settingsMocks = vi.hoisted(() => ({ visibility: vi.fn(), refresh: vi.fn(), release: vi.fn(), releaseStatus: vi.fn() }));
vi.mock("next/navigation", () => { const router = { refresh: settingsMocks.refresh }; return { useRouter: () => router }; });
vi.mock("@/app/servers/server-visibility-actions", () => ({ setServerVisibility: settingsMocks.visibility }));
vi.mock("@/app/servers/server-release-actions", () => ({ changeServerRelease: settingsMocks.release, readServerReleaseStatus: settingsMocks.releaseStatus }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    settingsMocks.visibility.mockReset(); settingsMocks.refresh.mockReset();
    settingsMocks.release.mockReset(); settingsMocks.releaseStatus.mockReset();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.history.replaceState(null, "", "/servers/test");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
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
    await act(async () => { window.location.hash = "server-visibility"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
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
async function saveSettings() {
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
it("discards local settings drafts without calling the managed server action", async () => {
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="private" visibilityAccess={visibilityAccess} />));
    await act(async () => container.querySelector<HTMLInputElement>('input[value="public"]')!.click());
    await act(async () => click("Discard"));
    expect(container.querySelector<HTMLInputElement>("#settings-server-name")!.value).toBe("Campaign");
    expect(container.querySelector<HTMLInputElement>('input[value="private"]')!.checked).toBe(true);
    expect(settingsMocks.visibility).not.toHaveBeenCalled();
});
it("confirms publishing before saving, retains unconfirmed failures and retries the same visibility request", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    settingsMocks.visibility.mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce({ ok: true, message: "Update acknowledged" });
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="private" visibilityAccess={visibilityAccess} />));
    await act(async () => container.querySelector<HTMLInputElement>('input[value="public"]')!.click());
    await saveSettings();
    expect(settingsMocks.visibility).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await saveSettings();
    const first = settingsMocks.visibility.mock.calls[0][0];
    expect(first).toEqual(expect.objectContaining({ serverId: "managed-server", visibility: "public", expectedUpdatedAt: visibilityAccess.expectedUpdatedAt, requestId: expect.any(String) }));
    expect(container.textContent).toContain("could not be confirmed");
    await saveSettings();
    expect(settingsMocks.visibility.mock.calls[1][0]).toEqual(first);
    expect(settingsMocks.refresh).toHaveBeenCalled();
});
it("saves a managed owner's visibility while keeping the recorded name read-only", async () => {
    settingsMocks.visibility.mockResolvedValue({ ok: true, message: "Update acknowledged" });
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="public" visibilityAccess={visibilityAccess} />));
    expect(container.querySelector<HTMLInputElement>("#settings-server-name")!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('input[value="private"]')!.click());
    await saveSettings();
    expect(settingsMocks.visibility).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }));
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="private" visibilityAccess={{ ...visibilityAccess, expectedUpdatedAt: "2026-09-14T00:00:00.000Z" }} />));
    expect(container.textContent).toContain("No pending changes");
});

it("opens visibility setup from the header and a direct reload link", async () => {
    const content = <ServerManagementWorkspace name={<h1>Live server</h1>} summary="Live" visibility={<a href="#server-visibility">Set up visibility</a>}>
        <ServerWorkspacePanel section="Console"><div>Live console</div></ServerWorkspacePanel>
        <ServerWorkspacePanel section="Settings"><section id="server-visibility">Visibility setup</section></ServerWorkspacePanel>
    </ServerManagementWorkspace>;
    await act(async () => root.render(content));
    expect(container.querySelector("#server-visibility")!.closest("[hidden]")).not.toBeNull();
    await act(async () => {
        window.history.replaceState(null, "", "#server-visibility");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(container.querySelector("#server-visibility")!.closest("[hidden]")).toBeNull();
    await act(async () => click("Console"));
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="#server-visibility"]')!.click());
    expect(container.querySelector("#server-visibility")!.closest("[hidden]")).toBeNull();
    await act(async () => root.render(null));
    await act(async () => root.render(content));
    expect(container.querySelector("#server-visibility")!.closest("[hidden]")).toBeNull();
});


it("saves the selected release only on Save and shows durable progress through completion", async () => {
    vi.useFakeTimers();
    const serverId = "11111111-1111-4111-8111-111111111111";
    const jobId = "22222222-2222-4222-8222-222222222222";
    const expectedUpdatedAt = "2026-09-29T12:00:00.000Z";
    settingsMocks.releaseStatus.mockResolvedValueOnce({ serverId, releaseChannel: "stable", job: null })
        .mockResolvedValueOnce({ serverId, releaseChannel: "nightly", job: { jobId, state: "running", progress: "Saving and stopping the server" } })
        .mockResolvedValueOnce({ serverId, releaseChannel: "nightly", job: { jobId, state: "running", progress: "Installing the selected server version" } })
        .mockResolvedValueOnce({ serverId, releaseChannel: "nightly", job: { jobId, state: "running", progress: "Starting the server and checking readiness" } })
        .mockResolvedValue({ serverId, releaseChannel: "nightly", job: { jobId, state: "succeeded", progress: "Finishing up" } });
    settingsMocks.release.mockResolvedValue({ ok: true, jobId, message: "Release change queued." });
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" releaseAccess={{ serverId, channel: "stable", expectedUpdatedAt, canEdit: true }} />));
    const select = container.querySelector<HTMLSelectElement>("#settings-release-channel")!;
    expect([...select.options].map(option => option.text)).toEqual(["Stable", "Nightly"]);
    await act(async () => { select.value = "nightly"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(settingsMocks.release).not.toHaveBeenCalled();
    await act(async () => click("Save settings"));
    expect(settingsMocks.release).toHaveBeenCalledWith({ serverId, releaseChannel: "nightly", expectedUpdatedAt, requestId: expect.any(String) });
    expect(select.disabled).toBe(true);
    expect(container.textContent).toContain("Saving and stopping the server");
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(container.textContent).toContain("Installing the selected server version");
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(container.textContent).toContain("Starting the server and checking readiness");
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(container.textContent).toContain("Release update completed");
    const polls = settingsMocks.releaseStatus.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(8_000));
    expect(settingsMocks.releaseStatus).toHaveBeenCalledTimes(polls);
    vi.useRealTimers();
});

it("retains the release request identity after an unconfirmed response", async () => {
    settingsMocks.releaseStatus.mockResolvedValue({ serverId: "11111111-1111-4111-8111-111111111111", releaseChannel: "stable", job: null });
    settingsMocks.release.mockResolvedValue({ ok: false, message: "Unconfirmed" });
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" releaseAccess={{ serverId: "11111111-1111-4111-8111-111111111111", channel: "stable", expectedUpdatedAt: "2026-09-29T12:00:00.000Z", canEdit: true }} />));
    await act(async () => { const select = container.querySelector<HTMLSelectElement>("select")!; select.value = "nightly"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => click("Save settings"));
    await act(async () => click("Save settings"));
    expect(settingsMocks.release.mock.calls[1][0]).toEqual(settingsMocks.release.mock.calls[0][0]);
});


it("carries visibility's new generation into a combined channel save", async () => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    const before = "2026-09-29T12:00:00.000Z", after = "2026-09-29T12:00:01.000Z";
    settingsMocks.releaseStatus.mockResolvedValue({ serverId, releaseChannel: "stable", job: null });
    settingsMocks.visibility.mockResolvedValue({ ok: true, updatedAt: after, message: "Visibility saved" });
    settingsMocks.release.mockResolvedValue({ ok: false, rejected: true, message: "Nightly unavailable" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" visibility="private"
        visibilityAccess={{ serverId, expectedUpdatedAt: before, canEdit: true }}
        releaseAccess={{ serverId, channel: "stable", expectedUpdatedAt: before, canEdit: true }} />));
    await act(async () => {
        container.querySelector<HTMLInputElement>('input[value="public"]')!.click();
        const select = container.querySelector<HTMLSelectElement>("select")!;
        select.value = "nightly"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => click("Save settings"));
    expect(settingsMocks.release).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: after, releaseChannel: "nightly" }));
    expect(container.textContent).toContain("Visibility saved Nightly unavailable");
});

it("restores failed update status on reload without claiming completion", async () => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    settingsMocks.releaseStatus.mockResolvedValue({ serverId, releaseChannel: "nightly", job: { jobId: serverId, state: "failed", progress: "Finishing up" } });
    await act(async () => root.render(<ServerSettingsPanel name="Campaign" releaseAccess={{ serverId, channel: "nightly", expectedUpdatedAt: "2026-09-29T12:00:00.000Z", canEdit: true }} />));
    expect(container.textContent).toContain("Release update failed");
    expect(container.textContent).not.toContain("Release update completed");
    expect(settingsMocks.release).not.toHaveBeenCalled();
});
