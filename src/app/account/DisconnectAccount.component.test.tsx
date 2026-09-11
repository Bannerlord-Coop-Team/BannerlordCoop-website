import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DisconnectAccount } from "./DisconnectAccount";

it.each(["Discord", "Patreon"] as const)("requires confirmation and supports cancellation for %s", async provider => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const action = vi.fn(async () => {});
    try {
        await act(async () => root.render(<DisconnectAccount provider={provider} action={action} />));
        const trigger = container.querySelector("button")!;
        await act(async () => trigger.click());
        expect(action).not.toHaveBeenCalled();
        expect(container.textContent).toContain(`Confirm disconnect ${provider}`);
        const cancel = [...container.querySelectorAll("button")].find(button => button.textContent === "Cancel")!;
        await act(async () => cancel.click());
        expect(container.querySelector("form")).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(action).not.toHaveBeenCalled();
        await act(async () => trigger.click());
        await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
        expect(action).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
it("explains and disables Discord disconnect when it is the only sign-in method", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    const action = vi.fn(async () => {});
    try {
        await act(async () => root.render(<DisconnectAccount provider="Discord" action={action} disabledReason="Discord is your only sign-in method." />));
        const trigger = container.querySelector("button")!;
        expect(trigger.disabled).toBe(true);
        await act(async () => trigger.click());
        expect(container.querySelector("form")).toBeNull();
        expect(action).not.toHaveBeenCalled();
        expect(container.textContent).toContain("only sign-in method");
    } finally { await act(async () => root.unmount()); }
});
