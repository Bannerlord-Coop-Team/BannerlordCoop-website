"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type CSSProperties } from "react";

/** Room a hint needs below its figure before it opens above it instead. */
const HINT_ROOM = 280;
const HINT_WIDTH = 320;
const HINT_MARGIN = 8;
/** How long a released press waits for its click; a click follows its release at once unless something cancels it. */
const RELEASED_PRESS_MS = 1000;

/**
 * The page's one open hint and where it is drawn. Opening a hint replaces it, so however many MetricHints a page
 * has, and in however many React roots, at most one is open.
 */
type OpenHint = { id: string; style: CSSProperties };
let openHint: OpenHint | null = null;
const listeners = new Set<() => void>();

/** Pointers that hover: a mouse, or a pen held over the screen. A finger only presses. */
function hovers(pointerType: string) {
    return pointerType === "mouse" || pointerType === "pen";
}

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
 * The tooltip opens when a mouse or pen hovers the figure, when the figure takes keyboard focus, and on a tap. It
 * closes when the mouse or pen leaves, focus leaves the figure or moves to any other control, Escape is pressed
 * (wherever focus is), the figure is tapped again or activated again with Enter or Space, anything outside the
 * figure is pressed, or the window scrolls or resizes. Because focus moving anywhere else closes it, it is never
 * left open over a dialog opened from another control: `showModal()` moves focus into the dialog first. Escape
 * with a hint open closes only the hint and stops the key there, so Escape handlers further along (a menu, a
 * panel) act only on the next Escape; a native modal dialog that the hint itself sits in still closes too, by its
 * own `cancel` event. Only one is open on a page at a time: opening one closes any other. The tooltip is fixed to
 * the window, right-aligned with its figure and below it (above it near the window's foot), so a scroll box around
 * the figure never clips it. It reads as plain sentences even where the figure inherits an upper-case, spaced-out
 * label style, such as a table header.
 */
export function MetricHint({ label, hint }: MetricHintProps) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    // The press under way on the figure: its pointer, whether the hint was open before it (a tap's focus opens it
    // first), and whether the pointer has been released. Forgotten once it clicks or can no longer click.
    const press = useRef<{ pointerType: string; wasOpen: boolean; released: boolean } | null>(null);
    // Stops watching for what cancels a released press's click.
    const stopWatchingPress = useRef<(() => void) | null>(null);
    const open = useSyncExternalStore(subscribe, () => (openHint?.id === id ? openHint : null), () => null);
    const isOpen = open !== null;

    const forgetPress = () => {
        press.current = null;
        stopWatchingPress.current?.();
        stopWatchingPress.current = null;
    };

    // A released press keeps its click's toggle, but a scroll or a press elsewhere cancels that click, and a click
    // that has not come within a second never will; any of them forgets the press.
    const holdReleasedPress = () => {
        if (press.current === null) return;
        press.current.released = true;
        stopWatchingPress.current?.();
        const forget = () => forgetPress();
        const pressElsewhere = (event: Event) => {
            if (!(event.target instanceof Node) || !trigger.current?.contains(event.target)) forget();
        };
        const timer = window.setTimeout(forget, RELEASED_PRESS_MS);
        window.addEventListener("scroll", forget, true);
        document.addEventListener("pointerdown", pressElsewhere, true);
        stopWatchingPress.current = () => {
            window.clearTimeout(timer);
            window.removeEventListener("scroll", forget, true);
            document.removeEventListener("pointerdown", pressElsewhere, true);
        };
    };

    // A hint that goes away while open does not stay open in the store, nor leave a press watched.
    useEffect(() => {
        const watching = stopWatchingPress;
        return () => {
            closeHint(id);
            watching.current?.();
        };
    }, [id]);

    useEffect(() => {
        if (!isOpen) return;
        // A scroll or resize would leave the hint behind its figure, so it closes instead.
        const close = () => closeHint(id);
        const outside = (event: Event) => {
            if (!(event.target instanceof Node) || !trigger.current?.contains(event.target)) close();
        };
        // Escape closes the open hint wherever focus is: it may have opened by hover, by a tap that left focus
        // elsewhere, or in place of a focused figure's hint. The hint is the topmost layer, so that Escape stops
        // here and Escape handlers further along act only on the next one. Focus moving to any other control
        // (`outside` on focusin) has already closed a hint before a dialog opened from elsewhere takes focus, so
        // the dialog's own Escape, its `cancel` event, never meets an open hint.
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || openHint?.id !== id) return;
            event.stopPropagation();
            close();
        };
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("focusin", outside, true);
        document.addEventListener("keydown", escape, true);
        return () => {
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("focusin", outside, true);
            document.removeEventListener("keydown", escape, true);
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
            // Only a mouse or pen hovers; a tap's emulated hover would open the hint just before its click closed it.
            onPointerEnter={(event) => { if (hovers(event.pointerType)) show(); }}
            onPointerLeave={(event) => {
                // Dragged off before release, the press cannot click. A finger leaves after its release but
                // before its click, so a released press stays for that click.
                if (press.current !== null && !press.current.released) forgetPress();
                if (hovers(event.pointerType)) hide();
            }}
            onPointerDown={(event) => {
                forgetPress();
                press.current = { pointerType: event.pointerType, wasOpen: openHint?.id === id, released: false };
            }}
            onPointerUp={holdReleasedPress}
            // A cancelled touch, a scroll or a context menu ends the press without a click.
            onPointerCancel={forgetPress}
            onContextMenu={forgetPress}
            onFocus={show}
            onBlur={() => { forgetPress(); hide(); }}
            onClick={(event) => {
                const pressed = press.current;
                forgetPress();
                // Enter or Space clicks with no pointer (detail 0), so it toggles by the hint alone, as does a click
                // with no press seen; a press never decides it.
                if (event.detail === 0 || pressed === null) {
                    if (openHint?.id === id) hide();
                    else show();
                    return;
                }
                // A mouse or pen click keeps open what hovering opened; a tap toggles it.
                if (hovers(pressed.pointerType) || !pressed.wasOpen) show();
                else hide();
            }}
            className="cursor-help underline decoration-white/30 decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold"
        >
            {label}
        </button>
        <span id={id} role="tooltip" hidden={!isOpen} style={open?.style} className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-1rem)] border border-white/15 bg-background px-3 py-2 text-left font-sans text-xs leading-5 font-normal tracking-normal normal-case text-foreground shadow-xl">
            {hint}
        </span>
    </>;
}
