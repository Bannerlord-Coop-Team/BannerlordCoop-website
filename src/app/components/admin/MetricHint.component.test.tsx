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
function pointer(target: EventTarget, type: string, pointerType: "mouse" | "pen" | "touch", init: MouseEventInit = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    target.dispatchEvent(event);
}

/**
 * A pointer's click as a browser sends it: press, focus (unless iOS Safari), release, then for a finger the
 * pointer leaving before the click, which counts one press (`detail` 1).
 */
function click(target: HTMLElement, pointerType: "mouse" | "touch", { focuses = true } = {}) {
    pointer(target, "pointerdown", pointerType);
    if (focuses && document.activeElement !== target) target.focus();
    pointer(target, "pointerup", pointerType);
    if (pointerType === "touch") pointer(target, "pointerout", pointerType, { relatedTarget: document.body });
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
}

/** Enter or Space on a focused button: a click with no pointer, `detail` 0. */
function activate(target: HTMLElement) {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
}

function escape(target: EventTarget) {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
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
    await act(async () => click(trigger, "mouse"));
    expect(tooltip.hidden).toBe(false);
    await act(async () => pointer(trigger, "pointerout", "mouse", { relatedTarget: document.body }));
    expect(tooltip.hidden).toBe(true);
});

it("toggles from the keyboard after focus opens it, and closes on Escape", async () => {
    const { trigger, tooltip } = await render("71% measured", "Share of the hours with data.");
    await act(async () => trigger.focus());
    expect(tooltip.hidden).toBe(false);
    // Enter or Space clicks the button with no pointer press.
    await act(async () => activate(trigger));
    expect(tooltip.hidden).toBe(true);
    await act(async () => activate(trigger));
    expect(tooltip.hidden).toBe(false);
    await act(async () => escape(trigger));
    expect(tooltip.hidden).toBe(true);
});

it("opens on a pen's hover and closes when it leaves, like a mouse", async () => {
    const { trigger, tooltip } = await render("7.5 pair-h measured", "Pairs online together.");
    await act(async () => pointer(trigger, "pointerover", "pen"));
    expect(tooltip.hidden).toBe(false);
    await act(async () => pointer(trigger, "pointerout", "pen", { relatedTarget: document.body }));
    expect(tooltip.hidden).toBe(true);
});

it("toggles on a tap though the finger leaves the button between its release and its click", async () => {
    const { trigger, tooltip } = await render("7.5 pair-h measured", "Pairs online together.");
    await act(async () => click(trigger, "touch"));
    expect(tooltip.hidden).toBe(false);
    await act(async () => click(trigger, "touch"));
    expect(tooltip.hidden).toBe(true);
});

it("closes on Escape a hint that replaced the focused figure's", async () => {
    const first = await render("71% measured", "Share of the hours with data.");
    const second = await render("7.5 pair-h measured", "Pairs online together.");
    await act(async () => first.trigger.focus());
    await act(async () => pointer(second.trigger, "pointerover", "mouse"));
    expect([first.tooltip.hidden, second.tooltip.hidden]).toEqual([true, false]);
    // The key goes to the focused first figure, whose own hint is already closed.
    await act(async () => escape(first.trigger));
    expect([first.tooltip.hidden, second.tooltip.hidden]).toEqual([true, true]);
});

it("closes on Escape a hint opened by hover while focus is on the page", async () => {
    const { trigger, tooltip } = await render("71% measured", "Share of the hours with data.");
    await act(async () => pointer(trigger, "pointerover", "mouse"));
    expect(document.activeElement).toBe(document.body);
    expect(tooltip.hidden).toBe(false);
    await act(async () => escape(document.body));
    expect(tooltip.hidden).toBe(true);
});

const pressesWithoutClick = [
    ["a right-click", (trigger: HTMLElement) => {
        pointer(trigger, "pointerdown", "mouse", { button: 2 });
        trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
        pointer(trigger, "pointerup", "mouse", { button: 2 });
    }],
    ["a cancelled touch", (trigger: HTMLElement) => {
        pointer(trigger, "pointerdown", "touch");
        pointer(trigger, "pointercancel", "touch");
    }],
    ["a press dragged off before release", (trigger: HTMLElement) => {
        pointer(trigger, "pointerdown", "touch");
        pointer(trigger, "pointerout", "touch", { relatedTarget: document.body });
    }],
    ["a press whose figure lost focus", (trigger: HTMLElement) => {
        pointer(trigger, "pointerdown", "touch");
        trigger.focus();
        trigger.blur();
    }],
] as const;
const activations = [
    ["Enter", activate],
    // A screen reader's activation can click with a count of one but no pointer press of its own.
    ["a click no press began", (trigger: HTMLElement) => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); }],
] as const;

it.each(pressesWithoutClick.flatMap(([pressName, pressWithoutClick]) => activations.map(([activationName, activation]) => [activationName, pressName, pressWithoutClick, activation] as const)))(
    "toggles on %s after %s that never clicked", async (_activation, _press, pressWithoutClick, activation) => {
        const { trigger, tooltip } = await render("71% measured", "Share of the hours with data.");
        // The press leaves the hint closed, then focus opens it and the activation closes it, whatever the press was.
        await act(async () => pressWithoutClick(trigger));
        expect(tooltip.hidden).toBe(true);
        await act(async () => trigger.focus());
        expect(tooltip.hidden).toBe(false);
        await act(async () => activation(trigger));
        expect(tooltip.hidden).toBe(true);
        await act(async () => activation(trigger));
        expect(tooltip.hidden).toBe(false);
    },
);

it("toggles on Enter by the hint alone, even while a pointer is still down on the figure", async () => {
    const { trigger, tooltip } = await render("71% measured", "Share of the hours with data.");
    // A mouse press focuses the figure and opens its hint; Enter before the release still closes it.
    await act(async () => { pointer(trigger, "pointerdown", "mouse"); trigger.focus(); });
    expect(tooltip.hidden).toBe(false);
    await act(async () => activate(trigger));
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
