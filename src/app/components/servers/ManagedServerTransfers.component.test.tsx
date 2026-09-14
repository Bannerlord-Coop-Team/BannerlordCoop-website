import { Blob as NodeBlob } from "node:buffer";
import { unzipSync, strFromU8 } from "fflate";
import { readConfigurationFile, applyConfigurationImport } from "../../../../supabase/functions/_shared/configuration-file-import";
import { act } from "react";
import { randomUUID } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerTransfers, readFileIntent } from "./ManagedServerTransfers";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION } from "../../../../supabase/functions/_shared/managed-server-configuration";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), check: vi.fn(), download: vi.fn(), config: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/servers/managed-server-file-actions", () => ({ submitManagedServerFile: mocks.submit, checkManagedServerFile: mocks.check, downloadManagedServerSave: mocks.download, exportManagedServerConfig: mocks.config }));
const status: OwnerFileStatus = { serverId: "11111111-1111-4111-8111-111111111111", updatedAt: "2026-09-13T00:00:00.000Z", operationState: "stopped", observedGameState: "stopped", activeSave: { saveId: "22222222-2222-4222-8222-222222222222", displayName: "Campaign" }, managedConfig: DEFAULT_MANAGED_SERVER_CONFIGURATION };
const job = { kind: "job", outcome: "enqueued", jobId: "33333333-3333-4333-8333-333333333333", action: "export-save", state: "queued" };
const key = `managed-file-transfer:v1:owner:${status.serverId}`;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); sessionStorage.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(current = status, owner = true, userId = "owner") {
    await act(async () => root.render(<ManagedServerTransfers userId={userId} serverId={current.serverId} status={current} canImportConfig={owner} />));
    await act(async () => vi.advanceTimersByTimeAsync(0));
}
function button(label: string) { const found = [...container.querySelectorAll("button")].find((el) => el.textContent === label); if (!found) throw Error(`Missing button ${label}`); return found; }
async function click(label: string) { await act(async () => button(label).click()); }

it("shows all four actions and disables saves while running and configuration import for managers", async () => {
    await render({ ...status, operationState: "running", observedGameState: "running" }, false);
    expect(button("Import save").disabled).toBe(true); expect(button("Export save").disabled).toBe(true);
    expect(button("Import config").disabled).toBe(true); expect(button("Export config").disabled).toBe(false);
    expect(container.textContent).toContain("Stop the server"); expect(container.textContent).toContain("Only the server owner");
});
it("retains uncertain request identity across retries and page remounts", async () => {
    mocks.submit.mockResolvedValue({ ok: false, rejected: false, message: "Unconfirmed" });
    await render(); await click("Export save");
    const original = JSON.parse(sessionStorage.getItem(key)!);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await click("Retry same request");
    expect(mocks.submit.mock.calls[1][0].get("requestId")).toBe(original.requestId);
    expect(mocks.submit.mock.calls[1][0].get("expectedUpdatedAt")).toBe(status.updatedAt);
    await act(async () => root.unmount()); root = createRoot(container);
    await render({ ...status, updatedAt: "2026-09-14T00:00:00.000Z" });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    mocks.check.mockResolvedValue({ ok: true, result: { ...job, state: "succeeded" } });
    await click("Check status");
    expect(mocks.check).toHaveBeenCalledWith(status.serverId, original.requestId, "owner");
    expect(button("Download save export").disabled).toBe(false);
    await click("Dismiss completed transfer"); expect(sessionStorage.getItem(key)).toBeNull();
});
it("keeps one pending dispatch and bounds polling after network loss", async () => {
    mocks.submit.mockResolvedValue({ ok: true, result: job });
    mocks.check.mockRejectedValue(new Error("Lost connection"));
    await render(); await act(async () => { button("Export save").click(); button("Export save").click(); });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(64_000));
    const calls = mocks.check.mock.calls.length;
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(15);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.check).toHaveBeenCalledTimes(calls);
    expect(container.textContent).toContain("Check status"); expect(sessionStorage.getItem(key)).not.toBeNull();
});
it("clears a definitively rejected stale request so refreshed inputs can be used", async () => {
    mocks.submit.mockResolvedValue({ ok: false, rejected: true, message: "The server changed" });
    await render(); await click("Export save");
    expect(sessionStorage.getItem(key)).toBeNull(); expect(mocks.refresh).toHaveBeenCalled();
});
it("does not dispatch when pending intent cannot be persisted, or recover a different account's request", async () => {
    await render();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("Disabled storage"); });
    await click("Export save"); expect(mocks.submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("paused");
    vi.restoreAllMocks();
    sessionStorage.setItem(key, JSON.stringify({ requestId: status.serverId, serverId: status.serverId, expectedUpdatedAt: status.updatedAt, action: "export-save", fingerprints: [], displayName: "", saveId: status.activeSave!.saveId }));
    await render(status, true, "another-owner"); expect(container.textContent).not.toContain("Check status");
});
it("reviews configuration changes and rejects secret fields before any submission", async () => {
    await render(); await click("Import config");
    const choice = container.querySelector("select")!;
    await act(async () => { choice.value = "combined"; choice.dispatchEvent(new Event("change", { bubbles: true })); });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    async function choose(config: unknown) {
        const file = new File([JSON.stringify(config)], "config.json", { type: "application/json" });
        Object.defineProperty(file, "text", { value: async () => JSON.stringify(config) });
        Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
        await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
        await click("Review import");
    }
    await choose({ ...status.managedConfig, password: "forbidden" });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await choose({ ...status.managedConfig, serverConfig: { ...status.managedConfig.serverConfig, autosaveMinutes: 10 } });
    expect(container.textContent).toContain("Autosave Minutes: 5 → 10");
    expect(button("Import these settings").disabled).toBe(false); expect(mocks.submit).not.toHaveBeenCalled();
});
it("rejects malformed stored fingerprints and cross-server identity", () => {
    const value = { requestId: status.serverId, serverId: status.serverId, expectedUpdatedAt: status.updatedAt, action: "import-save", fingerprints: [], displayName: "Campaign", saveId: status.activeSave!.saveId };
    expect(() => readFileIntent(JSON.stringify(value), status.serverId)).toThrow();
    expect(() => readFileIntent("a".repeat(2049), status.serverId)).toThrow();
});

it("guides individual imports, catches choosing the wrong file, and previews only the selected settings", async () => {
    await render(); await click("Import config");
    expect(container.textContent).toContain("1. Which file are you importing?");
    expect(container.textContent).toContain("DedicatedServer");
    expect(container.textContent).toContain("You do not need to open or edit it");
    async function choose(contents: string) {
        const file = new File([contents], "config.json", { type: "application/json" });
        Object.defineProperty(file, "text", { value: async () => contents });
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
        Object.defineProperty(input, "files", { configurable: true, value: [file] });
        await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
        await click("Review import");
    }
    await choose('{"modOptions":{"autoPauseEnabled":false}}');
    expect(container.textContent).toContain("This looks like mod-config.json");
    await choose('{// Original file\n"autosaveMinutes":10,"password":"never-show-this",}');
    expect(container.textContent).toContain("Importing server settings only");
    expect(container.textContent).toContain("Your gameplay settings will stay the same");
    expect(container.textContent).toContain("Server password");
    expect(container.textContent).not.toContain("never-show-this");
    await click("Back");
    const choice = container.querySelector("select")!;
    await act(async () => { choice.value = "mod"; choice.dispatchEvent(new Event("change", { bubbles: true })); });
    await choose('{"modOptions":{"autoPauseEnabled":false}}');
    expect(container.textContent).toContain("Importing gameplay settings only");
    expect(container.textContent).toContain("Your server settings will stay the same");
    expect(container.textContent).toContain("Auto Pause Enabled: On → Off");
    expect(mocks.submit).not.toHaveBeenCalled();
});

it.each(["mod", "server", undefined])("recovers the original config choice for a pending %s import", async (configPart) => {
    sessionStorage.setItem(key, JSON.stringify({ requestId: status.serverId, serverId: status.serverId, expectedUpdatedAt: status.updatedAt, action: "import-config", fingerprints: ["a".repeat(64)], displayName: "", saveId: status.activeSave!.saveId, ...(configPart ? { configPart } : {}) }));
    await render(); await click("Retry same request");
    const choice = container.querySelector("select")!;
    expect(choice.value).toBe(configPart ?? "combined");
    expect(choice.disabled).toBe(true);
    expect(mocks.submit).not.toHaveBeenCalled();
});

it("requires another review if current server settings change before confirmation", async () => {
    await render(); await click("Import config");
    const file = new File(['{"autosaveMinutes":10}'], "server-config.json");
    Object.defineProperty(file, "text", { value: async () => '{"autosaveMinutes":10}' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await click("Review import");
    await render({ ...status, updatedAt: "2026-09-14T00:00:00.000Z" });
    await click("Import these settings");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Go back and review your file again");
});

it("rejects invisible campaign names and allows corrected input after a local submission failure and refresh", async () => {
    vi.stubGlobal("crypto", { randomUUID, subtle: { digest: async () => new Uint8Array(32).buffer } });
    await render(); await click("Import save");
    async function enterName(name: string) {
        const input = container.querySelector<HTMLInputElement>('input:not([type="file"])')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }
    async function chooseFile() {
        const file = new File(["save"], "campaign.blcexport");
        Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
        Object.defineProperty(input, "files", { configurable: true, value: [file] });
        await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    }
    await chooseFile();
    for (const name of ["Bad\u200BName", "Bad\u0001Name"]) {
        await enterName(name); await click("Review import");
        expect(container.textContent).toContain("contains invisible characters");
        expect(mocks.submit).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(key)).toBeNull();
    }
    let rejectedId: string;
    mocks.submit.mockImplementationOnce(async (form: FormData) => {
        rejectedId = form.get("requestId") as string;
        expect(JSON.parse(sessionStorage.getItem(key)!).requestId).toBe(rejectedId);
        return { ok: false, notSubmitted: true, rejected: false, message: "The transfer was not sent." };
    });
    await enterName("First campaign"); await click("Review import"); await click("Confirm import");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(key)).toBeNull();
    await act(async () => root.unmount()); root = createRoot(container);
    await render();
    for (const label of ["Import save", "Export save", "Import config", "Export config"]) expect(button(label).disabled).toBe(false);
    mocks.submit.mockResolvedValue({ ok: true, result: { ...job, action: "import-save", state: "succeeded" } });
    await click("Import save"); await enterName("Corrected campaign"); await chooseFile();
    await click("Review import"); await click("Confirm import");
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[1][0].get("requestId")).not.toBe(rejectedId!);
    expect(mocks.submit.mock.calls[1][0].get("displayName")).toBe("Corrected campaign");
    expect(sessionStorage.getItem(key)).toBeNull();
});

it("retains an earlier uncertain request if its retry fails before submission", async () => {
    mocks.submit.mockResolvedValueOnce({ ok: false, notSubmitted: false, rejected: false, message: "Unconfirmed" });
    await render(); await click("Export save");
    const original = sessionStorage.getItem(key);
    mocks.submit.mockResolvedValueOnce({ ok: false, notSubmitted: true, rejected: false, message: "Not sent" });
    await click("Retry same request");
    expect(sessionStorage.getItem(key)).toBe(original);
    expect(container.textContent).toContain("Your previous request is still saved");
    expect(button("Import save").disabled).toBe(true);
});

it("downloads two correctly named native JSON files in one ZIP that each import independently", async () => {
    const managedConfig = { ...status.managedConfig, serverConfig: { ...status.managedConfig.serverConfig, autosaveMinutes: 11 } };
    mocks.config.mockResolvedValue({ ok: true, managedConfig });
    let archive: NodeBlob | undefined;
    let filename = "";
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("URL", { createObjectURL: vi.fn((blob: NodeBlob) => { archive = blob; return "blob:config-export"; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    await render(status, false);
    await click("Export config");
    expect(mocks.config).toHaveBeenCalledWith(status.serverId, "owner");
    expect(filename).toBe("BannerlordCoop-configuration.zip");
    const entries = unzipSync(new Uint8Array(await archive!.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(["mod-config.json", "server-config.json"]);
    expect(JSON.parse(strFromU8(entries["server-config.json"]))).toEqual(managedConfig.serverConfig);
    expect(JSON.parse(strFromU8(entries["mod-config.json"]))).toEqual(managedConfig.modConfig);
    for (const part of ["server", "mod"] as const) {
        const imported = readConfigurationFile(strFromU8(entries[`${part}-config.json`]), part);
        expect(imported.ignoredSettings).toEqual([]);
        expect(applyConfigurationImport(managedConfig, imported.input)).toEqual(managedConfig);
    }
    expect(container.textContent).toContain("Extract All");
    expect(container.textContent).toContain("do not select the ZIP");
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:config-export");
});

it("keeps config export failures retryable without downloading a file", async () => {
    mocks.config.mockRejectedValue(new Error("Network interrupted"));
    await render(); await click("Export config");
    expect(container.textContent).toContain("Configuration download failed. Please try again.");
    expect(button("Export config").disabled).toBe(false);
    expect(sessionStorage.getItem(key)).toBeNull();
});

it("shows real configuration in the wireframe preview without enabling unsupported editing", async () => {
    await render();
    const editor = container.querySelector<HTMLTextAreaElement>("#config-json")!;
    expect(JSON.parse(editor.value)).toEqual(status.managedConfig);
    expect(editor.disabled).toBe(true);
    for (const label of ["JSON", "Form preview", "Discard", "Save config"]) expect(button(label).disabled).toBe(true);
    expect(button("Import config").disabled).toBe(false);
    expect(button("Export config").disabled).toBe(false);
    expect(container.querySelector("#campaign-save-heading")?.closest("section")?.textContent).toContain("Campaign");
});
