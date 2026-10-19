"use client";

import type { ReactNode } from "react";
import { useId } from "react";

/** Keeps disabled controls explainable without relying on browser-specific disabled-button hover behavior. */
export function DisabledControlHint({ disabled, message, children }: { disabled: boolean; message: string; children: ReactNode }) {
    const tooltipId = useId();
    if (!disabled) return <>{children}</>;
    return <span className="group relative inline-flex" tabIndex={0} aria-describedby={tooltipId}>
        {children}
        <span id={tooltipId} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-max max-w-xs -translate-x-1/2 whitespace-normal rounded border border-white/15 bg-background px-3 py-2 text-left text-xs leading-5 text-foreground shadow-xl group-hover:block group-focus:block group-focus-within:block">{message}</span>
    </span>;
}
