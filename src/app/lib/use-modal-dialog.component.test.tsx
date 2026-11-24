import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useModalDialog } from "./use-modal-dialog";

let container: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); opener.remove(); });

/** A bare dialog driven by the hook, focusing its input on open. */
function Probe({ onFocusNotRestored }: { onFocusNotRestored: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    useModalDialog(dialogRef, inputRef, onFocusNotRestored);
    return <dialog ref={dialogRef}><input ref={inputRef} aria-label="First field" /></dialog>;
}

/** Opens the probe dialog with a fallback spy, returning the spy. */
async function open() {
    const fallback = vi.fn();
    await act(async () => root.render(<Probe onFocusNotRestored={fallback} />));
    return fallback;
}

it("focuses the given element on open and refocuses the opener on close without the fallback", async () => {
    const fallback = await open();
    expect(container.querySelector("dialog")!.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("input"));
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
    expect(fallback).not.toHaveBeenCalled();
});

it.each([
    ["left the page", () => opener.remove()],
    ["became disabled", () => { opener.disabled = true; }],
])("runs the fallback instead of refocusing an opener that %s", async (_name, change) => {
    const fallback = await open();
    change();
    await act(async () => root.render(null));
    expect(fallback).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(opener);
});
