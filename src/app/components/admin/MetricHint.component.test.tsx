import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MetricHint } from "./MetricHint";

let mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(async () => {
    for (const { container, root } of mounted) {
        await act(async () => root.unmount());
        container.remove();
    }
    mounted = [];
});

/** Renders one hint in its own React root and returns its button and tooltip. */
async function render(label: string, hint: string) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    await act(async () => root.render(<p><MetricHint label={label} hint={hint} /></p>));
    const trigger = container.querySelector("button")!;
    return { trigger, tooltip: document.getElementById(trigger.getAttribute("aria-describedby")!)! };
}

/** A pointer event; jsdom has no PointerEvent, so it is a mouse event carrying the pointer's type. */
function pointer(target: EventTarget, type: string, pointerType: "mouse" | "touch", init: MouseEventInit = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    target.dispatchEvent(event);
}

it("names its button by the figure and describes it by the hint", async () => {
    const { trigger, tooltip } = await render("71% measured", "Share of the hours with data.");
    expect(trigger.type).toBe("button");
    expect(trigger.textContent).toBe("71% measured");
    expect(tooltip.getAttribute("role")).toBe("tooltip");
    expect(tooltip.textContent).toBe("Share of the hours with data.");
    expect(tooltip.hidden).toBe(true);
});

it("opens on a mouse's hover but not on a tap's emulated one", async () => {
    const { trigger, tooltip } = await render("7.5 pair-h measured", "Pairs online together.");
    await act(async () => pointer(trigger, "pointerover", "touch"));
    expect(tooltip.hidden).toBe(true);
    await act(async () => pointer(trigger, "pointerover", "mouse"));
    expect(tooltip.hidden).toBe(false);
    // Clicking what hovering opened keeps it open.
    await act(async () => { pointer(trigger, "pointerdown", "mouse"); trigger.focus(); trigger.click(); });
    expect(tooltip.hidden).toBe(false);
    await act(async () => pointer(trigger, "pointerout", "mouse", { relatedTarget: document.body }));
    expect(tooltip.hidden).toBe(true);
});

it("toggles from the keyboard after focus opens it, and closes on Escape", async () => {
    const { trigger, tooltip } = await render("71% measured", "Share of the hours with data.");
    await act(async () => trigger.focus());
    expect(tooltip.hidden).toBe(false);
    // Enter or Space clicks the button with no pointer press.
    await act(async () => trigger.click());
    expect(tooltip.hidden).toBe(true);
    await act(async () => trigger.click());
    expect(tooltip.hidden).toBe(false);
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(tooltip.hidden).toBe(true);
});

it("keeps one hint open across the page, even in separate React roots", async () => {
    const first = await render("71% measured", "Share of the hours with data.");
    const second = await render("7.5 pair-h measured", "Pairs online together.");
    await act(async () => first.trigger.focus());
    await act(async () => pointer(second.trigger, "pointerover", "mouse"));
    expect([first.tooltip.hidden, second.tooltip.hidden]).toEqual([true, false]);
    // Leaving the second leaves none open, though the first keeps focus.
    await act(async () => pointer(second.trigger, "pointerout", "mouse", { relatedTarget: document.body }));
    expect([first.tooltip.hidden, second.tooltip.hidden]).toEqual([true, true]);
});
