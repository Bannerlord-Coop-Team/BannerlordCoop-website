"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

type DownloadLinkProps = {
    children: ReactNode;
    className?: string;
    onNavigate?: () => void;
};

export function DownloadLink({
    children,
    className,
    onNavigate,
}: DownloadLinkProps) {
    function handleClick(event: MouseEvent<HTMLAnchorElement>) {
        const downloadSection = document.getElementById("download");

        onNavigate?.();

        if (!downloadSection) return;

        event.preventDefault();
        window.history.replaceState(null, "", "/#download");

        // Closing the mobile menu restores body scrolling in its effect cleanup.
        requestAnimationFrame(() => {
            downloadSection.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    return (
        <Link href="/#download" onClick={handleClick} className={className}>
            {children}
        </Link>
    );
}