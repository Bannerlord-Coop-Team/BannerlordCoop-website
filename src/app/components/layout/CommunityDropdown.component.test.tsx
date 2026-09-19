import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { CommunityDropdown } from "./CommunityDropdown";

function pointerEvent(type: string, pointerType: string) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    return event;
}

it("opens on mouse hover without changing touch click behavior", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<CommunityDropdown />));
        const dropdown = container.firstElementChild!;
        const trigger = container.querySelector("button")!;

        await act(async () => dropdown.dispatchEvent(pointerEvent("pointerover", "mouse")));
        expect(trigger.getAttribute("aria-expanded")).toBe("true");

        await act(async () => dropdown.dispatchEvent(pointerEvent("pointerout", "mouse")));
        expect(trigger.getAttribute("aria-expanded")).toBe("false");

        await act(async () => dropdown.dispatchEvent(pointerEvent("pointerover", "touch")));
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        await act(async () => trigger.click());
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
