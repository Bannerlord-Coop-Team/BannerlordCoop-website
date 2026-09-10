import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyJoinButton } from "./CopyJoinButton";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe("copy server address", () => {
    it("copies exactly IP:port and only reports success after clipboard completion", async () => {
        let finish!: () => void;
        const writeText = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        const onCopied = vi.fn();
        await act(async () => root.render(<CopyJoinButton address="203.0.113.10:7210" onCopied={onCopied} />));
        await act(async () => container.querySelector("button")!.click());
        expect(writeText).toHaveBeenCalledWith("203.0.113.10:7210");
        expect(onCopied).not.toHaveBeenCalled();
        expect(container.querySelector('[role="status"]')?.textContent).toBe("");
        await act(async () => finish());
        expect(container.querySelector("button")?.textContent).toContain("Copied!");
        expect(onCopied).toHaveBeenCalledOnce();
    });

    it.each([false, true])("offers manual copy when clipboard is unavailable or rejects (%s)", async (rejects) => {
        vi.stubGlobal("navigator", rejects
            ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } }
            : {});
        const onCopied = vi.fn();
        await act(async () => root.render(<CopyJoinButton address="203.0.113.10:7210" onCopied={onCopied} />));
        await act(async () => container.querySelector("button")!.click());
        expect(container.querySelector('[role="status"]')?.textContent).toContain("Copy manually: 203.0.113.10:7210");
        expect(onCopied).not.toHaveBeenCalled();
    });

    it("does not copy missing or offline endpoints", async () => {
        const writeText = vi.fn();
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        await act(async () => root.render(<CopyJoinButton address={null} />));
        await act(async () => container.querySelector("button")!.click());
        await act(async () => root.render(<CopyJoinButton address="203.0.113.10:7210" disabled />));
        await act(async () => container.querySelector("button")!.click());
        expect(writeText).not.toHaveBeenCalled();
    });
});
