import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PatreonAutoCompletion } from "./PatreonAutoCompletion";

it("submits once after hydration, including StrictMode effect replay and rerenders", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const action = vi.fn(async () => {});
    try {
        await act(async () => root.render(<StrictMode><PatreonAutoCompletion action={action} /></StrictMode>));
        expect(submit).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain("Finishing your Patreon connection");
        await act(async () => root.render(<StrictMode><PatreonAutoCompletion action={action} /></StrictMode>));
        expect(submit).toHaveBeenCalledTimes(1);
        expect(container.querySelector('button[type="submit"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        container.remove();
        submit.mockRestore();
    }
});
