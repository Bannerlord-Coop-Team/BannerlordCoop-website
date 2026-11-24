"use client";

import { useEffect, type RefObject } from "react";

/** Shows a native dialog modally with page scroll locked and `initialFocus` focused; on close, restores the scroll and a still-usable opener's focus. */
export function useModalDialog(dialogRef: RefObject<HTMLDialogElement | null>, initialFocus: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog === null) return;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        if (!dialog.open) dialog.showModal();
        initialFocus.current?.focus();
        return () => {
            if (dialog.open) dialog.close();
            document.body.style.overflow = previousOverflow;
            if (canRestoreFocus(opener)) opener.focus();
        };
    }, [dialogRef, initialFocus]);
}

/** Whether focus can return to the element that opened a dialog: it is still in the page and not disabled. */
function canRestoreFocus(opener: HTMLElement | null): opener is HTMLElement {
    if (opener === null || !opener.isConnected) return false;
    return !opener.matches(":disabled");
}
