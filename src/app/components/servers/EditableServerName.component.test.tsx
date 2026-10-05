import { TestLocalization } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditableServerName } from "./EditableServerName";

const mocks = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("@/app/servers/name-actions", () => ({ renameLiveServer: mocks.rename }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.rename.mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

// Types into the controlled-by-DOM rename field the way a browser would.
async function enter(value: string) {
    const input = container.querySelector<HTMLInputElement>("#server-name-live-server")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

it("explains an invalid name beside the field without calling the rename action", async () => {
    mocks.rename.mockResolvedValue({ ok: true, displayName: "Renamed" });
    await act(async () => root.render(<TestLocalization><EditableServerName canEdit initialName="Live" serverId="live-server" /></TestLocalization>));
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="Edit server name"]')!.click());
    await enter("   ");
    await act(async () => container.querySelector("form")!.requestSubmit());
    const input = container.querySelector<HTMLInputElement>("#server-name-live-server")!;
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a server name.");
    // The rejected draft stays in the field instead of reverting to the old name beside the error.
    expect(input.value).toBe("   ");
    await enter("Renamed");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(container.querySelector("h1")?.textContent).toBe("Renamed");
});
