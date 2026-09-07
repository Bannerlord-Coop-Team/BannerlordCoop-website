"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export function ClickableTableRow({
    children,
    href,
    label,
}: {
    children: ReactNode;
    href: string;
    label: string;
}) {
    const router = useRouter();

    function open(event: MouseEvent<HTMLTableRowElement>) {
        if (event.defaultPrevented) return;
        router.push(href);
    }

    function openWithKeyboard(event: KeyboardEvent<HTMLTableRowElement>) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        router.push(href);
    }

    return (
        <tr
            role="link"
            tabIndex={0}
            aria-label={label}
            onClick={open}
            onKeyDown={openWithKeyboard}
            className="group cursor-pointer transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold/60"
        >
            {children}
        </tr>
    );
}
