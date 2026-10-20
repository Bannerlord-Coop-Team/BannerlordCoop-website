import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TestLocalization } from "./ManagedServerLocalization.test-utils";
import { ServerModsPanel } from "./ServerModsPanel";
import { moveServerMod, ServerModsError, toggleServerMod, type ServerModCatalog } from "@/app/lib/hosting/server-mods";
import { createMockServerModCatalog, sampleOwnerMod, sampleServerMods } from "@/app/lib/hosting/server-mods-mock";

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
    // Archive building yields to the browser between files, so wait until the panel is idle again.
    for (let attempt = 0; attempt < 100 && container.querySelector("section")?.getAttribute("aria-busy") !== "false"; attempt += 1) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
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
    expect(button("Save load order")).toBeUndefined();
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
    expect(container.textContent).not.toContain("Mods players need");
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
