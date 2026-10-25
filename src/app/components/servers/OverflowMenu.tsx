"use client";

import { MoreHorizontal } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { iconButtonClass } from "./segmented-controls";

const ENABLED_ITEMS = '[role="menuitem"]:not(:disabled)';
const NAVIGATION_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

/** Undefined outside an overflow menu's owner; null until the menu panel has mounted. */
export const OverflowMenuSlotContext = createContext<HTMLElement | null | undefined>(undefined);

/** Returns the overflow menu panel that menu items can portal into, or undefined when there is no menu. */
export function useOverflowMenuSlot() {
    return useContext(OverflowMenuSlotContext);
}

/** The menu's panel element, found by role so items portaled into it need no shared ref. */
function panelOf(root: HTMLElement) {
    return root.querySelector<HTMLElement>(':scope > [role="menu"]');
}

/** Moves focus to the first, last, previous or next enabled menu item for a navigation key. */
function stepFocus(root: HTMLElement, key: string) {
    const items = [...(panelOf(root)?.querySelectorAll<HTMLElement>(ENABLED_ITEMS) ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = key === "Home" ? 0 : key === "End" ? items.length - 1
        : key === "ArrowDown" ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1;
    items[next].focus();
}

/**
 * A "more actions" button that opens a menu of rare actions. The panel stays mounted while closed, so other
 * components can portal their own menu items into it through `panelRef`.
 */
export function OverflowMenu({ label, panelRef, children }: { label: string; panelRef?: (panel: HTMLDivElement | null) => void; children: ReactNode }) {
    const id = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const root = rootRef.current;
        if (!open || !root) return;
        stepFocus(root, "Home");
        // Leaving the menu by pointer or focus dismisses it without stealing focus back.
        const dismiss = (event: Event) => { if (!root.contains(event.target as Node)) setOpen(false); };
        document.addEventListener("pointerdown", dismiss);
        document.addEventListener("focusin", dismiss);
        return () => {
            document.removeEventListener("pointerdown", dismiss);
            document.removeEventListener("focusin", dismiss);
        };
    }, [open]);

    // Native listeners, because portaled items reach the panel in the DOM but not through React's tree.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        // Handles Escape (close and return focus) and arrow navigation for the trigger and items.
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && open) {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
                return;
            }
            if (!NAVIGATION_KEYS.includes(event.key)) return;
            event.preventDefault();
            if (!open) setOpen(true);
            else stepFocus(root, event.key);
        };
        // Closes the menu after an item is activated, unless the item keeps its own feedback open.
        const onClick = (event: MouseEvent) => {
            const item = (event.target as Element).closest('[role="menuitem"]');
            if (!item || item.closest("[data-keep-open]")) return;
            setOpen(false);
            triggerRef.current?.focus();
        };
        root.addEventListener("keydown", onKeyDown);
        root.addEventListener("click", onClick);
        return () => {
            root.removeEventListener("keydown", onKeyDown);
            root.removeEventListener("click", onClick);
        };
    }, [open]);

    return <div ref={rootRef} className="relative">
        <button ref={triggerRef} type="button" className={iconButtonClass} aria-label={label} title={label}
            aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
            <MoreHorizontal className="size-5" aria-hidden="true" />
        </button>
        <div ref={panelRef} id={id} role="menu" aria-label={label} hidden={!open}
            className={`${open ? "flex" : "hidden"} absolute top-full right-0 z-20 mt-1 w-52 flex-col rounded-md border border-white/15 bg-surface-raised p-1 shadow-xl`}>
            {children}
        </div>
    </div>;
}
