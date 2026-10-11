import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { addServerMod, findModuleFolderManifest, moveServerMod, parseSubModuleManifest, removeServerMod, toggleServerMod, type ServerMod } from "@/app/lib/hosting/server-mods";
import { ServerModsPanel } from "./ServerModsPanel";

const mods: ServerMod[] = [
    { id: "Native", name: "Native", version: "v1", enabled: true, pinned: true, required: true },
    { id: "Coop", name: "Coop", version: "v1", enabled: true, pinned: false, required: true },
    { id: "A", name: "Alpha", version: "v1", enabled: true, pinned: false, required: false },
    { id: "B", name: "Beta", version: "v1", enabled: false, pinned: false, required: false },
    { id: "C", name: "Gamma", version: "v1", enabled: true, pinned: false, required: false },
];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

// Reads the rendered load order as mod names.
function order() {
    return [...container.querySelectorAll("li label span:first-child")].map(span => span.textContent);
}

// Finds a mod's enable checkbox through its label.
function checkbox(name: string) {
    const label = [...container.querySelectorAll("label")].find(item => item.textContent?.startsWith(name))!;
    return document.getElementById(label.htmlFor) as HTMLInputElement;
}

// Builds a SubModule.xml body with the given module fields.
function manifest(id: string, name: string, version: string) {
    return `<?xml version="1.0" encoding="utf-8"?><Module><Name value="${name}"/><Id value="${id}"/><Version value="${version}"/><DependedModules><DependedModule Id="Native"/></DependedModules></Module>`;
}

// Simulates picking a folder; jsdom lacks Blob.text() and webkitRelativePath, so both are attached here.
async function chooseFolder(entries: Record<string, string>) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = Object.entries(entries).map(([path, content]) => Object.assign(new File([content], path.split("/").at(-1)!), { webkitRelativePath: path, text: async () => content }));
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

it("keeps movable mods, including required ones, below the pinned core modules", () => {
    expect(moveServerMod(mods, 4, 0).map(mod => mod.id)).toEqual(["Native", "C", "Coop", "A", "B"]);
    expect(moveServerMod(mods, 1, 9).map(mod => mod.id)).toEqual(["Native", "A", "B", "C", "Coop"]);
    expect(moveServerMod(mods, 0, 4).map(mod => mod.id)).toEqual(mods.map(mod => mod.id));
});

it("never disables or deletes required mods", () => {
    expect(toggleServerMod(mods, "B").find(mod => mod.id === "B")?.enabled).toBe(true);
    expect(toggleServerMod(mods, "Coop").find(mod => mod.id === "Coop")?.enabled).toBe(true);
    expect(removeServerMod(mods, "Coop")).toHaveLength(5);
    expect(removeServerMod(mods, "A").map(mod => mod.id)).toEqual(["Native", "Coop", "B", "C"]);
});

it("reads module fields from SubModule.xml and rejects duplicates", () => {
    expect(parseSubModuleManifest(manifest("Calradia", "Calradia Expanded", "v3.1.0"))).toEqual({ id: "Calradia", name: "Calradia Expanded", version: "v3.1.0", enabled: false, pinned: false, required: false });
    expect(parseSubModuleManifest("<Module><Name value=\"No id\"/></Module>")).toBeNull();
    expect(parseSubModuleManifest("not xml")).toBeNull();
    expect(addServerMod(mods, parseSubModuleManifest(manifest("c", "Other Gamma", "v1"))!)).toBeNull();
});

it("accepts only a module folder with SubModule.xml at its top level", () => {
    const butterLib = { webkitRelativePath: "Bannerlord.ButterLib/SubModule.xml" };
    expect(findModuleFolderManifest([{ webkitRelativePath: "Bannerlord.ButterLib/bin/ButterLib.dll" }, butterLib])).toBe(butterLib);
    expect(findModuleFolderManifest([{ webkitRelativePath: "ButterLib/submodule.XML" }])).not.toBeNull();
    expect(findModuleFolderManifest([{ webkitRelativePath: "Modules/Bannerlord.ButterLib/SubModule.xml" }])).toBeNull();
    expect(findModuleFolderManifest([{ webkitRelativePath: "Downloads/readme.txt" }])).toBeNull();
});

it("reorders by dragging a handle over another row", async () => {
    await act(async () => root.render(<ServerModsPanel initialMods={mods} canEdit />));
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Gamma"]')!;
    const dataTransfer = { setData() {}, setDragImage() {}, effectAllowed: "", dropEffect: "" };
    await act(async () => handle.dispatchEvent(Object.assign(new Event("dragstart", { bubbles: true }), { dataTransfer })));
    const alphaRow = container.querySelectorAll("li")[2];
    await act(async () => alphaRow.dispatchEvent(Object.assign(new Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer })));
    expect(order()).toEqual(["Native", "Coop", "Gamma", "Alpha", "Beta"]);
});

it("moves with arrow keys, keeps focus and announces the position", async () => {
    await act(async () => root.render(<ServerModsPanel initialMods={mods} canEdit />));
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Coop"]')!;
    handle.focus();
    await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(order()).toEqual(["Native", "Alpha", "Coop", "Beta", "Gamma"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reorder Coop");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Moved Coop to position 3 of 5.");
    await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(order()).toEqual(["Native", "Coop", "Alpha", "Beta", "Gamma"]);
});

it("enables and disables optional mods but keeps required ones on", async () => {
    await act(async () => root.render(<ServerModsPanel initialMods={mods} canEdit />));
    await act(async () => checkbox("Beta").click());
    expect(checkbox("Beta").checked).toBe(true);
    expect(checkbox("Native").disabled).toBe(true);
    expect(checkbox("Coop").disabled).toBe(true);
    expect(container.querySelector('[aria-label="Reorder Native"]')).toBeNull();
    expect(container.querySelector('[aria-label="Delete Native"]')).toBeNull();
    expect(container.querySelector('[aria-label="Delete Coop"]')).toBeNull();
});

it("uses a folder picker and adds the picked module folder as disabled", async () => {
    await act(async () => root.render(<ServerModsPanel initialMods={mods} canEdit />));
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.webkitdirectory).toBe(true);
    await chooseFolder({
        "Calradia/SubModule.xml": manifest("Calradia", "Calradia Expanded", "v3.1.0"),
        "Calradia/bin/Win64_Shipping_Client/Calradia.dll": "binary",
    });
    expect(order()).toEqual(["Native", "Coop", "Alpha", "Beta", "Gamma", "Calradia Expanded"]);
    expect(checkbox("Calradia Expanded").checked).toBe(false);
    expect(container.textContent).toContain("Calradia Expanded · v3.1.0");
    expect(container.textContent).toContain("Added Calradia Expanded (disabled).");
});

it("rejects a Modules folder, a folder without SubModule.xml, invalid manifests and duplicates", async () => {
    await act(async () => root.render(<ServerModsPanel initialMods={mods} canEdit />));
    await chooseFolder({ "Modules/Calradia/SubModule.xml": manifest("Calradia", "Calradia Expanded", "v3.1.0") });
    expect(container.textContent).toContain("Choose a single module folder, such as Bannerlord.ButterLib, with SubModule.xml at its top level.");
    await chooseFolder({ "Downloads/readme.txt": "hello" });
    expect(container.textContent).toContain("Choose a single module folder");
    await chooseFolder({ "Broken/SubModule.xml": "<Module/>" });
    expect(container.textContent).toContain("Broken/SubModule.xml has no module Id.");
    await chooseFolder({ "Gamma/SubModule.xml": manifest("C", "Gamma", "v2") });
    expect(container.textContent).toContain("Gamma (C) is already in the list.");
    expect(order()).toHaveLength(5);
});

it("deletes a mod only after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => root.render(<ServerModsPanel initialMods={mods} canEdit />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Delete Beta"]')!.click());
    expect(order()).toContain("Beta");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Delete Beta"]')!.click());
    expect(order()).toEqual(["Native", "Coop", "Alpha", "Gamma"]);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Deleted Beta.");
});

it("is read-only without edit access", async () => {
    await act(async () => root.render(<ServerModsPanel initialMods={mods} canEdit={false} />));
    expect(container.querySelector("[data-mod-handle]")).toBeNull();
    expect(container.querySelector('[aria-label^="Delete"]')).toBeNull();
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "Upload mod folder")?.disabled).toBe(true);
    expect([...container.querySelectorAll('input[type="checkbox"]')].every(input => (input as HTMLInputElement).disabled)).toBe(true);
    expect(container.textContent).toContain("read-only");
});
