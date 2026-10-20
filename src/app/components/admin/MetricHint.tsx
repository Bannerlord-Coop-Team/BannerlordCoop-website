"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type CSSProperties } from "react";

/** Room a hint needs below its figure before it opens above it instead. */
const HINT_ROOM = 280;
const HINT_WIDTH = 320;
const HINT_MARGIN = 8;

/**
 * The page's one open hint and where it is drawn. Opening a hint replaces it, so however many MetricHints a page
 * has, and in however many React roots, at most one is open.
 */
type OpenHint = { id: string; style: CSSProperties };
let openHint: OpenHint | null = null;
const listeners = new Set<() => void>();

function setOpenHint(next: OpenHint | null) {
    if (openHint === next) return;
    openHint = next;
    for (const listener of listeners) listener();
}

/** Closes hint `id` if it is the open one, leaving any other open hint alone. */
function closeHint(id: string) {
    if (openHint?.id === id) setOpenHint(null);
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export type MetricHintProps = {
    /** The figure as shown, such as "71% measured": the button's text and accessible name. */
    label: string;
    /** Plain text explaining the figure: the button's accessible description, shown beside it while open. */
    hint: string;
};

/**
 * A figure that explains itself: a button described by a tooltip (`role="tooltip"`, linked by
 * `aria-describedby`), so a screen reader announces the hint with the figure. Place it where the figure's text
 * would go; it renders the button and its tooltip as siblings, both phrasing content.
 *
 * The tooltip opens when a mouse hovers the figure, when the figure takes keyboard focus, and on a tap. It closes
 * when the mouse leaves, focus leaves, Escape is pressed, the figure is tapped again (or activated again from the
 * keyboard), anything outside the figure is pressed, or the window scrolls or resizes. Only one is open on a page
 * at a time: opening one closes any other. The tooltip is fixed to the window, right-aligned with its figure and
 * below it (above it near the window's foot), so a scroll box around the figure never clips it.
 */
export function MetricHint({ label, hint }: MetricHintProps) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    // The pointer that pressed the figure, and whether its hint was open before the press (focus opens it first).
    const press = useRef<{ pointerType: string; wasOpen: boolean } | null>(null);
    const open = useSyncExternalStore(subscribe, () => (openHint?.id === id ? openHint : null), () => null);
    const isOpen = open !== null;

    // A hint that goes away while open does not stay open in the store.
    useEffect(() => () => closeHint(id), [id]);

    useEffect(() => {
        if (!isOpen) return;
        // A scroll or resize would leave the hint behind its figure, so it closes instead.
        const close = () => closeHint(id);
        const pressOutside = (event: Event) => {
            if (!(event.target instanceof Node) || !trigger.current?.contains(event.target)) close();
        };
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        document.addEventListener("pointerdown", pressOutside, true);
        return () => {
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
            document.removeEventListener("pointerdown", pressOutside, true);
        };
    }, [isOpen, id]);

    const show = () => {
        if (openHint?.id === id) return;
        const rect = trigger.current?.getBoundingClientRect();
        if (rect === undefined) return;
        // Right-aligned with the figure and kept inside the window: below it, or above it near the window's foot.
        const right = Math.min(Math.max(HINT_MARGIN, window.innerWidth - rect.right), Math.max(HINT_MARGIN, window.innerWidth - HINT_WIDTH - HINT_MARGIN));
        setOpenHint({
            id,
            style: rect.bottom + HINT_ROOM > window.innerHeight && rect.top > HINT_ROOM
                ? { right, bottom: window.innerHeight - rect.top + 6 }
                : { right, top: rect.bottom + 6 },
        });
    };
    const hide = () => closeHint(id);
    return <>
        <button
            ref={trigger}
            type="button"
            aria-describedby={id}
            // Only a mouse hovers; a tap's emulated hover would open the hint just before its click closed it.
            onPointerEnter={(event) => { if (event.pointerType === "mouse") show(); }}
            onPointerLeave={(event) => { if (event.pointerType === "mouse") hide(); }}
            onPointerDown={(event) => { press.current = { pointerType: event.pointerType, wasOpen: openHint?.id === id }; }}
            onFocus={show}
            onBlur={hide}
            onClick={() => {
                const pressed = press.current;
                press.current = null;
                // A mouse click keeps open what hovering opened; a tap, or Enter or Space, toggles it.
                if (pressed?.pointerType === "mouse") show();
                else if (pressed === null ? openHint?.id === id : pressed.wasOpen) hide();
                else show();
            }}
            onKeyDown={(event) => { if (event.key === "Escape") hide(); }}
            className="cursor-help underline decoration-white/30 decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold"
        >
            {label}
        </button>
        <span id={id} role="tooltip" hidden={!isOpen} style={open?.style} className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-1rem)] border border-white/15 bg-background px-3 py-2 text-left font-sans text-xs leading-5 text-foreground shadow-xl">
            {hint}
        </span>
    </>;
}
