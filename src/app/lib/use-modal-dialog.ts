"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Shows a native dialog modally with page scroll locked and `initialFocus` focused; on close, restores the scroll and the opener's focus. */
export function useModalDialog(dialogRef: RefObject<HTMLDialogElement | null>, initialFocus: RefObject<HTMLElement | null>, onFocusNotRestored?: () => void) {
    // Captured on open, like the opener, so a caller's new callback identity never reopens the dialog.
    const fallback = useRef(onFocusNotRestored);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog === null) throw new Error("useModalDialog: dialog ref is not attached");
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const notRestored = fallback.current;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialog.showModal();
        initialFocus.current?.focus();
        return () => {
            dialog.close();
            document.body.style.overflow = previousOverflow;
            if (!restoreFocus(opener)) notRestored?.();
        };
    }, [dialogRef, initialFocus]);
}

/** Refocuses the element that opened a dialog when it is still in the page and enabled; reports whether focus landed there. */
function restoreFocus(opener: HTMLElement | null): boolean {
    if (opener === null || !opener.isConnected || opener.matches(":disabled")) return false;
    opener.focus();
    return document.activeElement === opener;
}
