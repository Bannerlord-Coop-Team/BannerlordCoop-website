import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { OverflowMenu } from "./OverflowMenu";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

/** Renders a menu with two actions and one that keeps the menu open for its own feedback. */
async function mount() {
    await act(async () => root.render(<OverflowMenu label="More actions">
        <button type="button" role="menuitem">First</button>
        <button type="button" role="menuitem" disabled>Skipped</button>
        <div data-keep-open><button type="button" role="menuitem">Last</button></div>
    </OverflowMenu>));
}

/** Dispatches a bubbling key press from an element. */
async function press(target: Element, key: string) {
    await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
}

const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const panel = () => container.querySelector<HTMLElement>('[role="menu"]')!;
const item = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === name)!;

it("discloses its menu through an accessible trigger and focuses the first enabled item", async () => {
    await mount();
    expect(trigger().getAttribute("aria-label")).toBe("More actions");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(panel().hidden).toBe(true);
    await act(async () => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(panel().hidden).toBe(false);
    expect(document.activeElement).toBe(item("First"));
});

it("moves between enabled items with the arrow keys, skipping disabled ones", async () => {
    await mount();
    await act(async () => trigger().click());
    await press(item("First"), "ArrowDown");
    expect(document.activeElement).toBe(item("Last"));
    await press(item("Last"), "ArrowDown");
    expect(document.activeElement).toBe(item("First"));
    await press(item("First"), "End");
    expect(document.activeElement).toBe(item("Last"));
});

it("closes on Escape and returns focus to the trigger", async () => {
    await mount();
    await act(async () => trigger().click());
    await press(item("First"), "Escape");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
});

it("closes after an item is chosen unless the item keeps the menu open", async () => {
    await mount();
    await act(async () => trigger().click());
    await act(async () => item("Last").click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await act(async () => item("First").click());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
});

it("closes when the pointer goes down outside it", async () => {
    await mount();
    await act(async () => trigger().click());
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
});
