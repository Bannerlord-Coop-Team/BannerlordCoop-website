import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RefreshReleaseCatalog } from "./RefreshReleaseCatalog";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// Refresh is a server-rendered catalog read, not a release import or promotion request.
it("refreshes discovery through the router", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<RefreshReleaseCatalog />));
        const button = container.querySelector("button")!;
        expect(button.textContent).toBe("Refresh GHCR releases");
        await act(async () => button.click());
        expect(refresh).toHaveBeenCalledOnce();
    } finally {
        await act(async () => root.unmount());
    }
});
