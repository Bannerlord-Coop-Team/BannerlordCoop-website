import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerConfigEditor } from "./ManagedServerConfigEditor";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION as config } from "../../../../supabase/functions/_shared/managed-server-configuration";
import type { RunnerConfigurationFile, RunnerConfigurationPart } from "../../../../supabase/functions/_shared/server-configuration-contract";

const mocks = vi.hoisted(() => ({ read: vi.fn(), readFiles: vi.fn(), save: vi.fn() }));
vi.mock("@/app/servers/managed-server-config-actions", () => ({
    readManagedServerConfig: mocks.read,
    // One action reads both files, so each load is a single request rather than two queued ones.
    readManagedServerConfigFiles: async (serverId: string, userId: string) => {
        mocks.readFiles(serverId, userId);
        const [server, mod] = await Promise.all([mocks.read(serverId, "server", userId), mocks.read(serverId, "mod", userId)]);
        return { server, mod };
    },
    saveManagedServerConfig: mocks.save,
}));

const serverId = "11111111-1111-4111-8111-111111111111";
const access = { serverId, userId: "owner", canEdit: true };
const revisions = { server: "a".repeat(64), mod: "b".repeat(64) };
const liveServer = { ...config.serverConfig, autosaveMinutes: 15 };
function file(part: RunnerConfigurationPart): RunnerConfigurationFile {
    return part === "server" ? { configPart: "server", revision: revisions.server, settings: liveServer }
        : { configPart: "mod", revision: revisions.mod, settings: config.modConfig };
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.read.mockImplementation(async (_serverId: string, part: RunnerConfigurationPart) => ({ ok: true, file: file(part) }));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

async function render(props: Parameters<typeof ManagedServerConfigEditor>[0] = { configuration: config, access }) {
    await act(async () => root.render(<TestLocalization>{<ManagedServerConfigEditor {...props} />} </TestLocalization>));
    await act(async () => {});
}
function button(label: string) { const found = [...container.querySelectorAll("button")].find((el) => el.textContent === label); if (!found) throw Error(`Missing button ${label}`); return found; }
async function click(label: string) { await act(async () => button(label).click()); }
function field<T extends HTMLElement>(id: string) { const found = container.querySelector<T>(`#${id}`); if (!found) throw Error(`Missing field ${id}`); return found; }
async function type(id: string, value: string) {
    const element = field<HTMLInputElement | HTMLTextAreaElement>(id);
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("loads the live runner files, defaults to the form and saves only the changed file with its revision", async () => {
    await render();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.read).toHaveBeenCalledWith(serverId, "server", "owner");
    expect(mocks.read).toHaveBeenCalledWith(serverId, "mod", "owner");
    expect(button("Form").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("#config-json")).toBeNull();
    expect(field<HTMLInputElement>("config-serverConfig-autosaveMinutes").value).toBe("15");
    expect(container.textContent).toContain("No pending changes");
    expect(button("Save config").disabled).toBe(true);
    await type("config-serverConfig-autosaveMinutes", "20");
    expect(container.textContent).toContain("Unsaved changes to server settings");
    expect(button("Save config").disabled).toBe(false);
    const saved = { ...liveServer, autosaveMinutes: 20 };
    mocks.save.mockResolvedValue({ ok: true, file: { configPart: "server", revision: "c".repeat(64), settings: saved } });
    await click("Save config");
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), serverId, configPart: "server", expectedRevision: revisions.server, settings: saved }, "owner");
    expect(container.textContent).toContain("Saved server settings");
    expect(container.textContent).toContain("No pending changes");
    // The next save of the same file must use the revision returned by the previous write.
    await type("config-serverConfig-autosaveMinutes", "25");
    mocks.save.mockResolvedValue({ ok: true, file: { configPart: "server", revision: "d".repeat(64), settings: { ...saved, autosaveMinutes: 25 } } });
    await click("Save config");
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: "c".repeat(64) }), "owner");
});

it("edits JSON, rejects invalid or unsupported settings and discards back to the loaded values", async () => {
    await render();
    await click("JSON");
    const editor = field<HTMLTextAreaElement>("config-json");
    expect(JSON.parse(editor.value)).toEqual({ serverConfig: liveServer, modConfig: config.modConfig });
    await type("config-json", "{ not json");
    expect(container.textContent).toContain("This isn't valid JSON (line 1, column 3)");
    expect(button("Save config").disabled).toBe(true);
    await type("config-json", JSON.stringify({ serverConfig: { ...liveServer, password: "secret" }, modConfig: config.modConfig }));
    expect(container.querySelector("#config-json-error")).not.toBeNull();
    expect(button("Save config").disabled).toBe(true);
    const gameplay = { ...config.modConfig, modOptions: { ...config.modConfig.modOptions, autoPauseEnabled: false } };
    await type("config-json", JSON.stringify({ serverConfig: liveServer, modConfig: gameplay }));
    expect(container.querySelector("#config-json-error")).toBeNull();
    expect(container.textContent).toContain("Unsaved changes to gameplay settings");
    await click("Form");
    expect(field<HTMLInputElement>("config-modOptions-autoPauseEnabled").checked).toBe(false);
    await click("Discard");
    expect(field<HTMLInputElement>("config-modOptions-autoPauseEnabled").checked).toBe(true);
    expect(container.textContent).toContain("No pending changes");
    expect(mocks.save).not.toHaveBeenCalled();
});

it("retries an unconfirmed save with the same request and reloads after a conflict", async () => {
    await render();
    await act(async () => field<HTMLInputElement>("config-modOptions-clientsCanUseCheats").click());
    mocks.save.mockRejectedValueOnce(new Error("Lost connection"));
    await click("Save config");
    expect(container.textContent).toContain("Connection interrupted");
    expect(container.textContent).toContain("Unsaved changes to gameplay settings");
    mocks.save.mockResolvedValueOnce({ ok: false, message: "The configuration changed or another server operation is in progress.", reload: true, notSubmitted: false });
    await click("Save config");
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0].requestId).toBe(mocks.save.mock.calls[0][0].requestId);
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ configPart: "mod", expectedRevision: revisions.mod });
    expect(container.textContent).toContain("The configuration changed");
    mocks.read.mockImplementation(async (_serverId: string, part: RunnerConfigurationPart) => ({ ok: true, file: part === "mod"
        ? { configPart: "mod", revision: "e".repeat(64), settings: config.modConfig } : file(part) }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await click("Reload settings");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("unsaved changes will be lost"));
    expect(mocks.read).toHaveBeenCalledTimes(4);
    expect(field<HTMLInputElement>("config-modOptions-clientsCanUseCheats").checked).toBe(false);
    expect(container.textContent).toContain("No pending changes");
    await act(async () => field<HTMLInputElement>("config-modOptions-clientsCanUseCheats").click());
    mocks.save.mockResolvedValueOnce({ ok: true, file: { configPart: "mod", revision: "f".repeat(64), settings: config.modConfig } });
    await click("Save config");
    // A conflict discards the old request identity so the retry after reload is a fresh edit.
    expect(mocks.save.mock.calls[2][0].requestId).not.toBe(mocks.save.mock.calls[0][0].requestId);
    expect(mocks.save.mock.calls[2][0].expectedRevision).toBe("e".repeat(64));
});

it("shows the stored configuration read-only without access and reports a failed live load", async () => {
    await render({ configuration: config });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(button("Form").getAttribute("aria-pressed")).toBe("true");
    expect(field<HTMLInputElement>("config-serverConfig-autosaveMinutes").value).toBe("5");
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    expect(button("Save config").disabled).toBe(true);
    expect(container.textContent).toContain("Only the server owner can edit configuration");
    await act(async () => root.unmount()); root = createRoot(container);
    mocks.read.mockResolvedValue({ ok: false, message: "This server has no active runner right now, so its configuration cannot be read.", reload: false, notSubmitted: false });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("no active runner");
    expect(field<HTMLInputElement>("config-serverConfig-autosaveMinutes").value).toBe("5");
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    await type("config-serverConfig-autosaveMinutes", "9");
    expect(button("Save config").disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
    await render({});
    expect(container.textContent).toContain("Configuration is unavailable for this server.");
    expect(button("Form").disabled).toBe(true);
    expect(button("JSON").disabled).toBe(true);
});

it("loads both runner files with one request", async () => {
    await render();
    expect(mocks.readFiles).toHaveBeenCalledExactlyOnceWith(serverId, "owner");
});

it("treats invalid JSON as a discardable edit and explains where it is wrong", async () => {
    await render();
    await click("JSON");
    await type("config-json", '{\n  "serverConfig": {\n    oops\n}');
    const error = container.querySelector("#config-json-error")!;
    expect(error.textContent).toContain("This isn't valid JSON (line 3, column 5)");
    expect(field<HTMLTextAreaElement>("config-json").getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("The JSON has unsaved edits that aren't valid yet.");
    expect(container.textContent).not.toContain("No pending changes");
    expect(button("Save config").disabled).toBe(true);
    expect(button("Discard").disabled).toBe(false);
    await click("Discard");
    expect(container.querySelector("#config-json-error")).toBeNull();
    expect(JSON.parse(field<HTMLTextAreaElement>("config-json").value)).toEqual({ serverConfig: liveServer, modConfig: config.modConfig });
    expect(container.textContent).toContain("No pending changes");
});

it("switches from invalid JSON to the form only after confirming the JSON edits are dropped", async () => {
    await render();
    await click("JSON");
    await type("config-json", JSON.stringify({ serverConfig: { ...liveServer, autosaveMinutes: 30 }, modConfig: config.modConfig }));
    await type("config-json", "{ broken");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await click("Form");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Switch to the form?"));
    expect(button("JSON").getAttribute("aria-pressed")).toBe("true");
    expect(field<HTMLTextAreaElement>("config-json").value).toBe("{ broken");
    confirm.mockReturnValueOnce(true);
    await click("Form");
    expect(button("Form").getAttribute("aria-pressed")).toBe("true");
    // The last valid JSON edit survives; only the broken text is dropped.
    expect(field<HTMLInputElement>("config-serverConfig-autosaveMinutes").value).toBe("30");
    expect(container.textContent).toContain("Unsaved changes to server settings");
});

it("asks before reloading over unsaved edits and reloads without asking when clean", async () => {
    await render();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("Reload settings");
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.readFiles).toHaveBeenCalledTimes(2);
    await type("config-serverConfig-autosaveMinutes", "42");
    await click("Reload settings");
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.readFiles).toHaveBeenCalledTimes(2);
    expect(field<HTMLInputElement>("config-serverConfig-autosaveMinutes").value).toBe("42");
    confirm.mockReturnValue(true);
    await click("Reload settings");
    expect(mocks.readFiles).toHaveBeenCalledTimes(3);
    expect(field<HTMLInputElement>("config-serverConfig-autosaveMinutes").value).toBe("15");
});

it("pins the save bar to the viewport only while there are unsaved changes", async () => {
    await render();
    const bar = () => container.querySelector("[data-unsaved-bar]");
    expect(bar()).toBeNull();
    await type("config-serverConfig-autosaveMinutes", "42");
    expect(bar()?.getAttribute("data-unsaved-bar")).toBe("pinned");
    expect(bar()?.className).toContain("fixed");
    await click("Discard");
    expect(bar()).toBeNull();
});

it("states once that configuration changes apply on the next start", async () => {
    await render();
    expect(container.textContent).toContain("Editing the files on the server's runner.");
    expect(container.textContent).not.toContain("next time the server starts");
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
