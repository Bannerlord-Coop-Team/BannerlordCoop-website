import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ADD_CAPACITY_SUMMARY, AddCapacityDialog, type AddCapacityTab } from "./AddCapacityDialog";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

/** Renders the dialog with stand-in panels, so these tests cover only opening, closing and switching tabs. */
async function render({ initialTab = "provider" as AddCapacityTab, onClose = vi.fn() } = {}) {
    await act(async () => root.render(<AddCapacityDialog initialTab={initialTab} onClose={onClose}
        provider={<button type="button">Provider form</button>} manual={<input aria-label="Manual form" />} />));
}

/** The tab or panel elements, in order. */
function tabs() { return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; }
function panels() { return [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')]; }

/** Presses a key on the currently focused tab. */
async function press(key: string) {
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

it("opens as a labelled modal on the requested tab with focus on that tab", async () => {
    await render({ initialTab: "manual" });
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Add capacity");
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(ADD_CAPACITY_SUMMARY);
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Onboarding source");
    expect(tabs().map((tab) => [tab.textContent, tab.getAttribute("aria-selected"), tab.tabIndex])).toEqual([
        ["Provider account", "false", -1], ["Manual entry", "true", 0],
    ]);
    expect(document.activeElement).toBe(tabs()[1]);
    const [provider, manual] = panels();
    expect(provider!.hidden).toBe(true);
    expect(manual!.hidden).toBe(false);
    expect(manual!.querySelector('[aria-label="Manual form"]')).not.toBeNull();
    expect(manual!.getAttribute("aria-labelledby")).toBe(tabs()[1]!.id);
    expect(tabs()[1]!.getAttribute("aria-controls")).toBe(manual!.id);
});

it("switches tabs by arrow key and click, keeping both panels mounted", async () => {
    await render();
    expect(document.activeElement).toBe(tabs()[0]);
    await press("ArrowRight");
    expect(tabs()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[1]);
    await act(async () => tabs()[0]!.click());
    expect(panels()[0]!.hidden).toBe(false);
    // The hidden panel stays mounted, so a half-typed form survives a tab switch.
    expect(panels()[1]!.querySelector('[aria-label="Manual form"]')).not.toBeNull();
});

it("asks to close on Escape and on the close button", async () => {
    const onClose = vi.fn();
    await render({ onClose });
    const dialog = container.querySelector("dialog")!;
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
});
