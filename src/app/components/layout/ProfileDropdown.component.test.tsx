import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));
import { ProfileDropdown } from "./ProfileDropdown";

it("shows the account name and server link, and closes with Escape restoring focus", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<ProfileDropdown accountName="Andrew" />));
        const trigger = container.querySelector("button")!;
        expect(trigger.getAttribute("aria-label")).toBe("Account menu for Andrew");
        await act(async () => trigger.click());
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(container.querySelector('a[href="/servers"]')?.textContent).toBe("My Servers");
        expect(container.textContent).toContain("Sign out");
        expect(container.textContent).not.toContain("Link account");
        await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
