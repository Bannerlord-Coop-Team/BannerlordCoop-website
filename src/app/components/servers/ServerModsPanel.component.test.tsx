import { Blob as NodeBlob } from "node:buffer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TestLocalization } from "./ManagedServerLocalization.test-utils";
import { ServerModsPanel } from "./ServerModsPanel";
import {
    changedServerModRunsOn, moveServerMod, sameServerModOrder, serverModLoadOrder, ServerModsError, setServerModRunsOn, toggleServerMod, type ServerMod, type ServerModCatalog,
} from "@/app/lib/hosting/server-mods";
import { createMockServerModCatalog, sampleOwnerMod, sampleServerMods, type MockServerModCatalog } from "./ServerModsPanel.test-utils";

const SERVER_ID = "22222222-2222-4222-8222-222222222222";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

/** The baseline list with three owner mods: Alpha (enabled), Beta (disabled, depends on Alpha) and Gamma. */
function mods() {
    return sampleServerMods([
        sampleOwnerMod("Alpha"),
        sampleOwnerMod("Beta", { enabled: false, dependsOn: ["Alpha"] }),
        sampleOwnerMod("Gamma", { issues: ["stripped:0Harmony.dll"] }),
    ]);
}

it("shows a suspended refusal and restores the saved order without replaying the mutation", async () => {
    const catalog = createMockServerModCatalog(mods());
    await render(catalog);
    const list = vi.spyOn(catalog, "listServerMods");
    const save = vi.spyOn(catalog, "saveServerModOrder").mockRejectedValueOnce(new ServerModsError("server_suspended", false));
    await click(checkbox("Beta"));
    expect(container.textContent).toContain("This server is suspended. The request was refused and no change was made.");
    expect(container.textContent).not.toContain("retry the same request");
    expect(checkbox("Beta").checked).toBe(false);
    expect(save).toHaveBeenCalledOnce();
    expect(list).not.toHaveBeenCalled();
});

it("keeps an upload unknown when a suspended reconciliation read cannot confirm it", async () => {
    const catalog = createMockServerModCatalog(mods());
    await render(catalog);
    vi.spyOn(catalog, "uploadServerMod").mockRejectedValueOnce(new ServerModsError("upload_status_unavailable", false, "NewMod"));
    vi.spyOn(catalog, "listServerMods").mockRejectedValueOnce(new ServerModsError("server_suspended", false));
    await chooseFolder({ "NewMod/SubModule.xml": submodule("NewMod", "New Mod", "v1") });
    expect(container.textContent).toContain("The install of NewMod could not be confirmed because the server is suspended.");
    expect(container.textContent).toContain("Refresh the mod list when access is restored");
    expect(container.textContent).not.toContain("no change was made");
    expect(container.textContent).not.toContain("not in the mod list");
});

/** Renders the panel and waits for its first load. */
async function render(catalog: ServerModCatalog, props: { canEdit?: boolean; active?: boolean } = {}) {
    await act(async () => root.render(<TestLocalization><ServerModsPanel serverId={SERVER_ID} catalog={catalog} canEdit={props.canEdit ?? true} active={props.active ?? true} /></TestLocalization>));
}

/** Reads the rendered load order as mod names. */
function order() {
    return [...container.querySelectorAll("ol li label span:first-child")].map(span => span.textContent);
}

/** Finds a mod's enable switch through its label. */
function checkbox(name: string) {
    const label = [...container.querySelectorAll("label")].find(item => item.textContent?.startsWith(name))!;
    return document.getElementById(label.htmlFor) as HTMLInputElement;
}

/** Finds a button by its exact text. */
function button(text: string) {
    return [...container.querySelectorAll("button")].find(item => item.textContent === text) as HTMLButtonElement | undefined;
}

/** Clicks an element inside act. */
async function click(element: Element) {
    await act(async () => { (element as HTMLElement).click(); });
}

/** Builds a SubModule.xml body. */
function submodule(id: string, name: string, version: string) {
    return `<?xml version="1.0" encoding="utf-8"?><Module><Name value="${name}"/><Id value="${id}"/><Version value="${version}"/></Module>`;
}

/** Simulates picking a folder; jsdom lacks webkitRelativePath and Blob.arrayBuffer, so both are attached here. */
async function chooseFolder(entries: Record<string, string>) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = Object.entries(entries).map(([path, content]) => {
        const bytes = new TextEncoder().encode(content);
        return Object.assign(new File([bytes], path.split("/").at(-1)!), { webkitRelativePath: path, arrayBuffer: async () => bytes.slice().buffer });
    });
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    // Archive building yields to the browser between files; those yields must run inside act, so poll there
    // (vi.waitFor would run them between its polls) and fail here, not later, if the panel never goes idle.
    const busy = () => container.querySelector("section")?.getAttribute("aria-busy");
    for (let attempt = 0; attempt < 100 && busy() !== "false"; attempt += 1) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    expect(busy(), "the panel stayed busy after picking a folder").toBe("false");
}

it("keeps movable mods between the pinned head and tail modules", () => {
    const list = mods();
    const ids = (items: { id: string }[]) => items.map(mod => mod.id);
    expect(ids(moveServerMod(list, 6, 0))).toEqual(["Native", "SandBoxCore", "SandBox", "Gamma", "Coop", "Alpha", "Beta", "DedicatedServer.Linux"]);
    expect(ids(moveServerMod(list, 3, 99))).toEqual(["Native", "SandBoxCore", "SandBox", "Alpha", "Beta", "Gamma", "Coop", "DedicatedServer.Linux"]);
    expect(ids(moveServerMod(list, 7, 3))).toEqual(ids(list));
    expect(toggleServerMod(list, "Coop").find(mod => mod.id === "Coop")?.enabled).toBe(true);
    expect(toggleServerMod(list, "Beta").find(mod => mod.id === "Beta")?.enabled).toBe(true);
});

it("loads only once the tab is shown", async () => {
    const catalog = createMockServerModCatalog(mods());
    const list = vi.spyOn(catalog, "listServerMods");
    await render(catalog, { active: false });
    expect(list).not.toHaveBeenCalled();
    await render(catalog, { active: true });
    expect(list).toHaveBeenCalledOnce();
    expect(order()).toEqual(["Native", "SandBoxCore", "SandBox", "Coop", "Alpha", "Beta", "Gamma", "DedicatedServer.Linux"]);
    expect(container.textContent).toContain("0Harmony.dll was removed; the server provides its own copy.");
    expect(container.textContent).toContain("Mod support is experimental and may have bugs.");
});

it("saves the complete order against the loaded revision when a drag ends", async () => {
    const catalog = createMockServerModCatalog(mods());
    const save = vi.spyOn(catalog, "saveServerModOrder");
    await render(catalog);
    const revision = catalog.state.revision;
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Gamma"]')!;
    const dataTransfer = { setData() {}, setDragImage() {}, effectAllowed: "", dropEffect: "" };
    await act(async () => { handle.dispatchEvent(Object.assign(new Event("dragstart", { bubbles: true }), { dataTransfer })); });
    const coopRow = container.querySelectorAll("ol li")[3];
    await act(async () => { coopRow.dispatchEvent(Object.assign(new Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer })); });
    expect(order()).toEqual(["Native", "SandBoxCore", "SandBox", "Gamma", "Coop", "Alpha", "Beta", "DedicatedServer.Linux"]);
    expect(save).not.toHaveBeenCalled();
    expect(button("Upload mod folder")?.disabled).toBe(true);
    await act(async () => { handle.dispatchEvent(Object.assign(new Event("dragend", { bubbles: true }), { dataTransfer })); });
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(SERVER_ID, revision, expect.arrayContaining([{ id: "Gamma", enabled: true }]));
    expect(save.mock.calls[0][2].map(entry => entry.id)).toEqual(["Native", "SandBoxCore", "SandBox", "Gamma", "Coop", "Alpha", "Beta", "DedicatedServer.Linux"]);
    expect(container.textContent).toContain("Load order saved.");
    expect(button("Upload mod folder")?.disabled).toBe(false);
});

it("moves with arrow keys, keeps focus, announces the position and saves once the owner pauses", async () => {
    const catalog = createMockServerModCatalog(mods());
    const save = vi.spyOn(catalog, "saveServerModOrder");
    await render(catalog);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Coop"]')!;
    handle.focus();
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(order().slice(3, 6)).toEqual(["Alpha", "Coop", "Beta"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reorder Coop");
    expect(container.querySelector('p[role="status"].sr-only')?.textContent).toBe("Moved Coop to position 5 of 8.");
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][2].map(entry => entry.id).slice(3, 7)).toEqual(["Alpha", "Beta", "Gamma", "Coop"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reorder Coop");
    expect(container.textContent).toContain("Load order saved.");
});

it("saves a pending arrow-key move when the panel unmounts before the delay ends", async () => {
    const catalog = createMockServerModCatalog(mods());
    const save = vi.spyOn(catalog, "saveServerModOrder");
    await render(catalog);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Coop"]')!;
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][2].map(entry => entry.id).slice(3, 5)).toEqual(["Alpha", "Coop"]);
});

it("leaves focus alone after an arrow key that cannot move the mod", async () => {
    await render(createMockServerModCatalog(mods()));
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Coop"]')!;
    handle.focus();
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    expect(order()[3]).toBe("Coop");
    handle.blur();
    await click(checkbox("Beta"));
    expect(document.activeElement).not.toBe(handle);
});

it("saves edits made during a save afterwards against the newer revision", async () => {
    const catalog = createMockServerModCatalog(mods());
    const original = catalog.saveServerModOrder.bind(catalog);
    let release = () => {};
    const save = vi.spyOn(catalog, "saveServerModOrder").mockImplementationOnce(async (...args) => {
        await new Promise<void>(resolve => { release = resolve; });
        return original(...args);
    });
    await render(catalog);
    const firstRevision = catalog.state.revision;
    await click(checkbox("Beta"));
    expect(container.textContent).toContain("Saving…");
    expect(container.querySelector('[aria-label="Delete Alpha"]')).toHaveProperty("disabled", true);
    await click(checkbox("Gamma"));
    expect(save).toHaveBeenCalledOnce();
    await act(async () => { release(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][1]).toBe(firstRevision);
    expect(save.mock.calls[1][1]).not.toBe(firstRevision);
    expect(save.mock.calls[1][2]).toEqual(expect.arrayContaining([{ id: "Beta", enabled: true }, { id: "Gamma", enabled: false }]));
    expect(checkbox("Beta").checked).toBe(true);
    expect(checkbox("Gamma").checked).toBe(false);
    expect(container.textContent).toContain("Load order saved.");
});

it("waits for a drag that started during a save to end before saving its order", async () => {
    const catalog = createMockServerModCatalog(mods());
    const original = catalog.saveServerModOrder.bind(catalog);
    let release = () => {};
    const save = vi.spyOn(catalog, "saveServerModOrder").mockImplementationOnce(async (...args) => {
        await new Promise<void>(resolve => { release = resolve; });
        return original(...args);
    });
    await render(catalog);
    await click(checkbox("Beta"));
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Gamma"]')!;
    const dataTransfer = { setData() {}, setDragImage() {}, effectAllowed: "", dropEffect: "" };
    const dragOver = (row: number) => container.querySelectorAll("ol li")[row].dispatchEvent(Object.assign(new Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer }));
    await act(async () => { handle.dispatchEvent(Object.assign(new Event("dragstart", { bubbles: true }), { dataTransfer })); });
    await act(async () => { dragOver(4); });
    await act(async () => { release(); });
    expect(save).toHaveBeenCalledOnce();
    await act(async () => { dragOver(3); });
    await act(async () => { handle.dispatchEvent(Object.assign(new Event("dragend", { bubbles: true }), { dataTransfer })); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][2].map(entry => entry.id).slice(3, 7)).toEqual(["Gamma", "Coop", "Alpha", "Beta"]);
});

it("toggles owner mods only and enforces the enabled limit", async () => {
    const catalog = createMockServerModCatalog(mods());
    const save = vi.spyOn(catalog, "saveServerModOrder");
    await render(catalog);
    await click(checkbox("Beta"));
    expect(checkbox("Beta").checked).toBe(true);
    expect(save).toHaveBeenCalledWith(SERVER_ID, expect.anything(), expect.arrayContaining([{ id: "Beta", enabled: true }]));
    for (const name of ["Native", "Coop", "DedicatedServer.Linux"]) expect(checkbox(name).disabled).toBe(true);
    expect(container.querySelector('[aria-label="Reorder Native"]')).toBeNull();
    expect(container.querySelector('[aria-label="Reorder DedicatedServer.Linux"]')).toBeNull();
    expect(container.querySelector('[aria-label="Delete Coop"]')).toBeNull();
    expect(container.querySelector('[aria-label="Delete Native"]')).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    const full = sampleServerMods([...Array.from({ length: 32 }, (_, index) => sampleOwnerMod(`On${index}`)), sampleOwnerMod("Off", { enabled: false })]);
    await render(createMockServerModCatalog(full));
    await click(checkbox("Off"));
    expect(checkbox("Off").checked).toBe(false);
    expect(container.textContent).toContain("At most 32 mods can be enabled at once.");
});

it("uploads a picked module folder and reports where it was installed", async () => {
    const catalog = createMockServerModCatalog(mods(), { running: true });
    const upload = vi.spyOn(catalog, "uploadServerMod");
    await render(catalog);
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.webkitdirectory).toBe(true);
    await chooseFolder({
        "Calradia-download/SubModule.xml": submodule("Calradia", "Calradia Expanded", "v3.1.0"),
        "Calradia-download/bin/Win64_Shipping_Client/Calradia.dll": "binary",
    });
    expect(upload).toHaveBeenCalledOnce();
    const archive = upload.mock.calls[0][2];
    expect(archive.manifest).toEqual({ id: "Calradia", name: "Calradia Expanded", version: "v3.1.0" });
    expect(order().slice(-2)).toEqual(["Calradia Expanded", "DedicatedServer.Linux"]);
    expect(container.textContent).toContain("Installed Calradia Expanded v3.1.0.");
    expect(container.textContent).toContain("The running game still uses the previous mods.");
});

it("confirms before replacing an installed mod and keeps its place", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const catalog = createMockServerModCatalog(mods());
    const upload = vi.spyOn(catalog, "uploadServerMod");
    await render(catalog);
    await chooseFolder({ "Alpha/SubModule.xml": submodule("Alpha", "Alpha", "v2.0.0") });
    expect(upload).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Replaced");
    await chooseFolder({ "Alpha/SubModule.xml": submodule("Alpha", "Alpha", "v2.0.0") });
    expect(confirm).toHaveBeenLastCalledWith("Alpha v1.0.0 is already installed. Replace it with version v2.0.0? It keeps its position and enabled setting.");
    expect(order()[4]).toBe("Alpha");
    expect(container.textContent).toContain("Replaced Alpha with version v2.0.0.");
});

it("explains folders that cannot be uploaded without sending anything", async () => {
    const catalog = createMockServerModCatalog(mods());
    const upload = vi.spyOn(catalog, "uploadServerMod");
    await render(catalog);
    await chooseFolder({ "Modules/Calradia/SubModule.xml": submodule("Calradia", "Calradia", "v1") });
    expect(container.textContent).toContain("The folder has no SubModule.xml at its top level.");
    await chooseFolder({ "Readme.txt": "hello" });
    expect(container.textContent).toContain("Choose a single module folder, such as Bannerlord.ButterLib");
    await chooseFolder({ "Coop/SubModule.xml": submodule("Coop", "Coop", "v1") });
    expect(container.textContent).toContain("Coop is the Id of a core module and cannot be uploaded.");
    await chooseFolder({ "Broken/SubModule.xml": "<Module><Name value=\"x\"/></Module>" });
    expect(container.textContent).toContain("SubModule.xml needs exactly one Id");
    expect(upload).not.toHaveBeenCalled();
});

it("deletes a mod only after confirmation and names a dependent that blocks it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const catalog = createMockServerModCatalog(sampleServerMods([sampleOwnerMod("Alpha"), sampleOwnerMod("Beta", { dependsOn: ["Alpha"] })]));
    await render(catalog);
    await click(container.querySelector('[aria-label="Delete Alpha"]')!);
    expect(container.textContent).toContain("Beta depends on this mod. Disable Beta first, then delete this one.");
    expect(order()).toContain("Alpha");
    confirm.mockReturnValueOnce(false);
    await click(container.querySelector('[aria-label="Delete Beta"]')!);
    expect(order()).toContain("Beta");
    await click(container.querySelector('[aria-label="Delete Beta"]')!);
    expect(order()).not.toContain("Beta");
    expect(container.textContent).toContain("Deleted Beta.");
});

it("reloads the list after a stale save and shows the saved list again after a plain refusal", async () => {
    const catalog = createMockServerModCatalog(mods());
    await render(catalog);
    const list = vi.spyOn(catalog, "listServerMods");
    vi.spyOn(catalog, "saveServerModOrder").mockRejectedValueOnce(new ServerModsError("revision_conflict"))
        .mockRejectedValueOnce(new ServerModsError("mod_order_invalid", false, "Beta"));
    await click(checkbox("Beta"));
    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("The mod list changed since it was loaded.");
    expect(checkbox("Beta").checked).toBe(false);
    await click(checkbox("Beta"));
    expect(container.textContent).toContain("This order breaks a load rule for Beta.");
    expect(checkbox("Beta").checked).toBe(false);
    expect(list).toHaveBeenCalledOnce();
});

it("shows the saved list and offers Refresh when the reload after an unknown save outcome also fails", async () => {
    const catalog = createMockServerModCatalog(mods());
    await render(catalog);
    vi.spyOn(catalog, "saveServerModOrder").mockRejectedValueOnce(new ServerModsError("control_plane_unavailable", true));
    vi.spyOn(catalog, "listServerMods").mockRejectedValueOnce(new ServerModsError("control_plane_unavailable", true));
    await click(checkbox("Beta"));
    expect(checkbox("Beta").checked).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be reached");
    expect(button("Refresh")?.disabled).toBe(false);
    expect(container.querySelector('[aria-label="Delete Alpha"]')).toHaveProperty("disabled", false);
    await click(button("Refresh")!);
    expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("offers a retry when the list cannot be loaded", async () => {
    const catalog = createMockServerModCatalog(mods());
    vi.spyOn(catalog, "listServerMods").mockRejectedValueOnce(new ServerModsError("runner_unsupported"));
    await render(catalog);
    expect(container.textContent).toContain("This server's host does not support custom mods yet.");
    await click(button("Try again")!);
    expect(order()).toHaveLength(8);
});

it("describes keyboard reordering to assistive technology without visible help text", async () => {
    await render(createMockServerModCatalog(mods()));
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Alpha"]')!;
    const help = document.getElementById(handle.getAttribute("aria-describedby")!)!;
    expect(help.className).toBe("sr-only");
    expect(help.textContent).toBe("Use the up and down arrow keys to move this mod.");
});

it("is read-only without mod access and never loads the list", async () => {
    const catalog = createMockServerModCatalog(mods());
    const list = vi.spyOn(catalog, "listServerMods");
    await render(catalog, { canEdit: false });
    expect(list).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Only the server owner and managers can view and change mods.");
    expect(container.textContent).toContain("Mod support is experimental and may have bugs.");
    expect(button("Upload mod folder")).toBeUndefined();
    expect(container.querySelector("ol")).toBeNull();
});

/** Locked runs-on fields with a reason, as the control plane reports them. */
function locked(runsOnLockReason: string): Partial<ServerMod> {
    return { runsOnLocked: true, runsOnLockReason };
}

/**
 * A list from a control plane that reports runs-on: Harmony (server-provided), a mod whose default is players
 * (named unlike any curated id, so nothing in the website can recognise it), a server mod and a disabled one.
 */
function runsOnMods(overrides: Partial<Record<string, Partial<ServerMod>>> = {}) {
    const mod = (id: string, values: Partial<ServerMod>) => sampleOwnerMod(id, { runsOn: "server", runsOnDefault: "server", runsOnLocked: false, ...values, ...overrides[id] });
    return sampleServerMods([
        mod("Bannerlord.Harmony", { name: "Harmony", version: "v2.4.2.225", runsOn: "players", runsOnDefault: "players", ...locked("server-provided") }),
        mod("ClientUi", { name: "Client UI", version: "v1.0.3", runsOn: "players", runsOnDefault: "players" }),
        mod("Gamma", { version: "v3.1.0", issues: ["no-render-tag-removed"] }),
        mod("Delta", { enabled: false }),
    ]);
}

/** Finds a mod's load-order row by its shown name. */
function row(name: string) {
    return [...container.querySelectorAll("ol > li")].find(item => item.querySelector("label span")?.textContent === name)!;
}

/** Picks a runs-on value in a mod's row. */
async function chooseRunsOn(name: string, value: "server" | "players") {
    const select = row(name).querySelector("select")!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}

/** Reads the "Mods players need" list as text lines. */
function playersNeed() {
    const heading = [...container.querySelectorAll("h3")].find(item => item.textContent === "Mods players need")!;
    return [...heading.parentElement!.querySelectorAll("li")].map(item => item.textContent);
}

/** Finds the "Download mod list" button, if shown. */
function downloadButton() {
    return [...container.querySelectorAll("button")].find(button => button.textContent === "Download mod list");
}

/** Builds the full order with one mod's runs-on changed, as the panel would send it. */
function orderWith(catalog: MockServerModCatalog, id: string, runsOn: "server" | "players") {
    return catalog.state.mods.map(mod => mod.id === id ? { id: mod.id, enabled: mod.enabled, runsOn } : { id: mod.id, enabled: mod.enabled });
}

it("offers no runs-on choice when the control plane does not report it, and still lists the mods players need", async () => {
    await render(createMockServerModCatalog(mods()));
    expect(container.querySelector("ol select")).toBeNull();
    expect(container.textContent).not.toContain("Runs on");
    expect(playersNeed()).toEqual(["AlphaAlpha v1.0.0", "GammaGamma v1.0.0"]);
    expect(container.textContent).toContain("players need exactly these mods at exactly these versions, and no other community mods besides Bannerlord Co-op.");
    expect(container.textContent).toContain("Players must also disable any official DLC, such as War Sails.");
});

it("says players need no community mods when no owner mod is enabled", async () => {
    await render(createMockServerModCatalog(sampleServerMods([sampleOwnerMod("Off", { enabled: false })])));
    expect(playersNeed()).toEqual([]);
    expect(container.textContent).toContain("Players need no community mods besides Bannerlord Co-op to join.");
    expect(container.textContent).toContain("Players must also disable any official DLC, such as War Sails.");
});

it("downloads the players' full load order as JSON, leaving out disabled and dedicated-server modules", async () => {
    await render(createMockServerModCatalog(runsOnMods()));
    let saved: NodeBlob | undefined;
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("URL", { createObjectURL: vi.fn((blob: NodeBlob) => { saved = blob; return "blob:mod-list"; }), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("BannerlordCoop-mod-list.json"); });
    vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
    await act(async () => downloadButton()!.click());
    vi.unstubAllGlobals();
    expect(click).toHaveBeenCalledOnce();
    expect(saved!.type).toBe("application/json");
    const file = JSON.parse(await saved!.text());
    expect(file).toMatchObject({ format: "bannerlord-coop-mod-list", formatVersion: 1, serverId: SERVER_ID, exportedAt: "2026-10-24T12:00:00.000Z" });
    expect(file.mods).toEqual([
        { order: 1, id: "Native", name: "Native", version: "", kind: "core", playersOnly: false },
        { order: 2, id: "SandBoxCore", name: "SandBoxCore", version: "", kind: "core", playersOnly: false },
        { order: 3, id: "SandBox", name: "SandBox", version: "", kind: "core", playersOnly: false },
        { order: 4, id: "Coop", name: "Coop", version: "", kind: "coop", playersOnly: false },
        { order: 5, id: "Bannerlord.Harmony", name: "Harmony", version: "v2.4.2.225", kind: "mod", playersOnly: true },
        { order: 6, id: "ClientUi", name: "Client UI", version: "v1.0.3", kind: "mod", playersOnly: true },
        { order: 7, id: "Gamma", name: "Gamma", version: "v3.1.0", kind: "mod", playersOnly: false },
    ]);
});

it("offers no mod list download when players need no community mods", async () => {
    await render(createMockServerModCatalog(sampleServerMods([sampleOwnerMod("Off", { enabled: false })])));
    expect(downloadButton()).toBeUndefined();
});

it("shows where each owner mod runs, locks Harmony, and lists players-only mods as needed by players", async () => {
    await render(createMockServerModCatalog(runsOnMods()));
    expect(row("Harmony").querySelector("select")).toBeNull();
    expect(row("Harmony").textContent).toContain("Runs only in players' games: the server provides Harmony.");
    expect(row("Client UI").querySelector("select")!.value).toBe("players");
    expect(row("Client UI").textContent).not.toContain("The server won't run this mod's code");
    expect(row("Gamma").querySelector("select")!.value).toBe("server");
    expect(row("Gamma").textContent).toContain("interface-only tags were removed");
    expect(row("Delta").querySelector("select")!.value).toBe("server");
    for (const name of ["Native", "Coop", "DedicatedServer.Linux"]) expect(row(name).textContent).not.toContain("Runs");
    expect(playersNeed()).toEqual([
        "HarmonyBannerlord.Harmony v2.4.2.225Players only: not run on the server",
        "Client UIClientUi v1.0.3Players only: not run on the server",
        "GammaGamma v3.1.0",
    ]);
});

it("warns before making a mod whose default is the server players only, and sends runsOn only for that mod", async () => {
    const catalog = createMockServerModCatalog(runsOnMods());
    const save = vi.spyOn(catalog, "saveServerModOrder");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await render(catalog);
    await chooseRunsOn("Gamma", "players");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Run Gamma in players' games only? The server won't run its code."));
    expect(save).not.toHaveBeenCalled();
    expect(row("Gamma").querySelector("select")!.value).toBe("server");

    await chooseRunsOn("Gamma", "players");
    expect(save).toHaveBeenCalledOnce();
    const sent = save.mock.calls[0][2];
    expect(sent.filter(entry => "runsOn" in entry)).toEqual([{ id: "Gamma", enabled: true, runsOn: "players" }]);
    expect(sent).toHaveLength(9);
    expect(catalog.state.mods.find(mod => mod.id === "Gamma")?.runsOn).toBe("players");
    expect(row("Gamma").textContent).toContain("A gameplay mod set to players only can make players' games disagree with the server or stop them joining.");
    expect(playersNeed()).toContain("GammaGamma v3.1.0Players only: not run on the server");
    expect(checkbox("Gamma").checked).toBe(true);
});

it("takes the warning from the control plane's default, not from the mod's id", async () => {
    // ItemQualityIndicator is on today's curated list; a control plane that defaults it to the server is still warned about.
    const catalog = createMockServerModCatalog(runsOnMods({ Gamma: { id: "ItemQualityIndicator", name: "Item Quality Indicator" } }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await render(catalog);
    await chooseRunsOn("Item Quality Indicator", "players");
    expect(confirm).toHaveBeenCalledOnce();
    expect(row("Item Quality Indicator").textContent).toContain("The server won't run this mod's code");
});

it("changes a mod whose default is players without a warning, independently of its enabled switch", async () => {
    const catalog = createMockServerModCatalog(runsOnMods());
    const confirm = vi.spyOn(window, "confirm");
    const save = vi.spyOn(catalog, "saveServerModOrder");
    await render(catalog);
    await chooseRunsOn("Client UI", "server");
    await chooseRunsOn("Client UI", "players");
    expect(confirm).not.toHaveBeenCalled();
    expect(save.mock.calls.map(call => call[2].filter(entry => "runsOn" in entry))).toEqual([
        [{ id: "ClientUi", enabled: true, runsOn: "server" }],
        [{ id: "ClientUi", enabled: true, runsOn: "players" }],
    ]);
    await click(checkbox("Delta"));
    expect(save.mock.calls.at(-1)![2].filter(entry => "runsOn" in entry)).toEqual([]);
    expect(checkbox("Delta").checked).toBe(true);
    expect(row("Delta").querySelector("select")!.value).toBe("server");
});

it.each([
    ["submodule-class-missing:FamilyAppearanceEditor.SubModule", "names a SubModule class (FamilyAppearanceEditor.SubModule) that its DLL doesn't contain"],
    ["submodule-dll-missing:Gamma.dll", "names a DLL (Gamma.dll) that isn't in the mod"],
    ["submodule-dll-unreadable:Gamma.Native.dll", "DLL Gamma.Native.dll couldn't be read as a .NET assembly"],
])("keeps a mod with %s players only, locked, and explains why", async (issue, text) => {
    await render(createMockServerModCatalog(runsOnMods({ Gamma: { runsOn: "players", ...locked("submodule-invalid"), issues: [issue] } })));
    expect(row("Gamma").querySelector("select")).toBeNull();
    expect(row("Gamma").textContent).toContain("Runs only in players' games: its server code is missing or can't be read (see the note below).");
    expect(row("Gamma").textContent).toContain(text);
    expect(row("Gamma").textContent).not.toContain("None of this mod's code runs on the server");
    expect(row("Gamma").textContent).not.toContain("The server won't run this mod's code");
});

it("shows each lock reason's copy, and generic copy for a reason it does not know", async () => {
    await render(createMockServerModCatalog(runsOnMods({
        // On a runner without players-only support Harmony runs on the server, so C3 reports it as runner-unsupported.
        "Bannerlord.Harmony": { runsOn: "server", ...locked("runner-unsupported") },
        ClientUi: locked("runner-unsupported"),
        Gamma: locked("core-module"),
        Delta: { runsOn: "players", ...locked("future-reason") },
    })));
    expect(container.querySelector("ol select")).toBeNull();
    expect(row("Harmony").textContent).toContain("Runs on the server and in players' games. This server needs a runner update before this can be changed.");
    expect(row("Client UI").textContent).toContain("Runs only in players' games. This server needs a runner update before this can be changed.");
    expect(row("Gamma").textContent).toContain("Runs on: Server and players. This can't be changed right now.");
    expect(row("Delta").textContent).toContain("Runs on: Players only. This can't be changed right now.");
});

it("explains a refused switch to the server by the control plane's issue and shows the saved list again", async () => {
    const catalog = createMockServerModCatalog(runsOnMods({ Delta: { runsOn: "players" } }));
    vi.spyOn(catalog, "saveServerModOrder")
        .mockRejectedValueOnce(new ServerModsError("mod_order_invalid", false, "Delta", "submodule-class-missing:Delta.SubModule"))
        .mockRejectedValueOnce(new ServerModsError("mod_order_invalid", false, "Delta"));
    await render(catalog);
    await chooseRunsOn("Delta", "server");
    expect(container.textContent).toContain("Delta can't run on the server. This mod names a SubModule class (Delta.SubModule) that its DLL doesn't contain");
    expect(row("Delta").querySelector("select")!.value).toBe("players");
    await chooseRunsOn("Delta", "server");
    expect(container.textContent).toContain("This order breaks a load rule for Delta.");
    expect(container.textContent).not.toContain("can't run on the server");
});

it("refuses runs-on changes in the test control plane by lock reason, as C3 section 2 does", async () => {
    const catalog = createMockServerModCatalog(runsOnMods({
        ClientUi: locked("runner-unsupported"),
        Delta: { runsOn: "players", ...locked("submodule-invalid"), issues: ["submodule-dll-unreadable:Delta.dll"] },
    }));
    const revision = catalog.state.revision;
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "Delta", "server")))
        .rejects.toMatchObject({ code: "mod_order_invalid", modId: "Delta", detail: "submodule-dll-unreadable:Delta.dll" });
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "ClientUi", "server"))).rejects.toMatchObject({ code: "runner_unsupported" });
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "Bannerlord.Harmony", "server"))).rejects.toMatchObject({ code: "mod_order_invalid", modId: "Bannerlord.Harmony" });
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "Coop", "players"))).rejects.toMatchObject({ code: "mod_order_invalid", modId: "Coop" });
    expect(catalog.state.revision).toBe(revision);
});

it("says the runner needs an update when it refuses a runs-on change, and reloads the locked list", async () => {
    const catalog = createMockServerModCatalog(runsOnMods());
    vi.spyOn(catalog, "saveServerModOrder").mockRejectedValueOnce(new ServerModsError("runner_unsupported"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await render(catalog);
    // The runner was rolled back after the list loaded: the refusal reloads the list, which now reports every owner mod locked.
    const stale = runsOnMods({ "Bannerlord.Harmony": { runsOn: "server", ...locked("runner-unsupported") }, ClientUi: locked("runner-unsupported"), Gamma: locked("runner-unsupported"), Delta: locked("runner-unsupported") });
    const list = vi.spyOn(catalog, "listServerMods").mockResolvedValueOnce({ ...catalog.state, mods: stale });
    await chooseRunsOn("Gamma", "players");
    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("This server's runner doesn't support players-only mods yet, so nothing was changed.");
    expect(row("Gamma").querySelector("select")).toBeNull();
    expect(row("Gamma").textContent).toContain("This server needs a runner update before this can be changed.");
    expect(row("Harmony").textContent).toContain("Runs on the server and in players' games. This server needs a runner update before this can be changed.");
});

it("evaluates runs-on changes in the test control plane in C3's order: echo, then static validity, then the runner", async () => {
    const all = locked("runner-unsupported");
    const catalog = createMockServerModCatalog(runsOnMods({
        "Bannerlord.Harmony": { runsOn: "server", ...all }, ClientUi: all, Gamma: all,
        Delta: { runsOn: "players", ...all, issues: ["submodule-class-missing:Delta.SubModule"] },
    }));
    const revision = catalog.state.revision;
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "Coop", "players"))).rejects.toMatchObject({ code: "mod_order_invalid", modId: "Coop" });
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "Delta", "server")))
        .rejects.toMatchObject({ code: "mod_order_invalid", modId: "Delta", detail: "submodule-class-missing:Delta.SubModule" });
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "Bannerlord.Harmony", "players"))).rejects.toMatchObject({ code: "runner_unsupported" });
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "Gamma", "players"))).rejects.toMatchObject({ code: "runner_unsupported" });
    expect(catalog.state.revision).toBe(revision);
    // Echoing every reported value, Harmony's "server" included, is accepted on this runner.
    await expect(catalog.saveServerModOrder(SERVER_ID, revision, orderWith(catalog, "Bannerlord.Harmony", "server"))).resolves.toMatchObject({ mods: catalog.state.mods });
});

it("changes runs-on only where the owner may and names it in the order only where it changed", () => {
    const base = runsOnMods({ Delta: { runsOn: "players", ...locked("submodule-invalid"), issues: ["submodule-dll-missing:Delta.dll"] } });
    const runsOn = (list: ServerMod[], id: string) => list.find(mod => mod.id === id)?.runsOn;
    expect(runsOn(setServerModRunsOn(base, "Bannerlord.Harmony", "server"), "Bannerlord.Harmony")).toBe("players");
    expect(runsOn(setServerModRunsOn(base, "Coop", "players"), "Coop")).toBe("server");
    expect(runsOn(setServerModRunsOn(base, "Delta", "server"), "Delta")).toBe("players");
    const changed = setServerModRunsOn(base, "Gamma", "players");
    expect(sameServerModOrder(changed, base)).toBe(false);
    expect(changedServerModRunsOn(changed, base).map(mod => mod.id)).toEqual(["Gamma"]);
    expect(serverModLoadOrder(changed, changedServerModRunsOn(changed, base)).filter(entry => "runsOn" in entry)).toEqual([{ id: "Gamma", enabled: true, runsOn: "players" }]);
    expect(changedServerModRunsOn(base, base)).toEqual([]);
    const legacy = mods();
    expect(setServerModRunsOn(legacy, "Alpha", "players")).toEqual(legacy);
    expect(changedServerModRunsOn(legacy, legacy)).toEqual([]);
    expect(serverModLoadOrder(legacy, [])).toEqual(legacy.map(({ id, enabled }) => ({ id, enabled })));
});

it("installs uploads with the control plane's runs-on defaults", async () => {
    const catalog = createMockServerModCatalog(runsOnMods());
    await render(catalog);
    await chooseFolder({ "Bannerlord.FamilyTree/SubModule.xml": submodule("Bannerlord.FamilyTree", "Family Tree", "v1.0.0") });
    await chooseFolder({ "NewGameplay/SubModule.xml": submodule("NewGameplay", "New Gameplay", "v1.0.0") });
    expect(row("Family Tree").querySelector("select")!.value).toBe("players");
    expect(row("Family Tree").textContent).not.toContain("The server won't run this mod's code");
    expect(row("New Gameplay").querySelector("select")!.value).toBe("server");
    expect(catalog.state.mods.find(mod => mod.id === "Bannerlord.FamilyTree")).toMatchObject({ runsOnDefault: "players", runsOnLocked: false });
    expect(catalog.state.mods.find(mod => mod.id === "NewGameplay")).toMatchObject({ runsOnDefault: "server", runsOnLocked: false });
});
