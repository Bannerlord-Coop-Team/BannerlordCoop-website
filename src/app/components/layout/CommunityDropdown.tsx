"use client";

import { ChevronDown, CircleHelp, History } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

const triggerClassName = "inline-flex min-h-10 cursor-pointer items-center gap-1.5 px-2 font-label text-sm font-semibold uppercase leading-none tracking-[0.16em] text-foreground-muted transition-colors duration-300 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const itemClassName = "group/item flex items-center gap-3 rounded-sm px-4 py-3 font-label text-sm font-semibold uppercase tracking-[0.12em] text-foreground-muted transition-colors hover:bg-white/5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";
const iconClassName = "size-4.5 shrink-0 transition-colors group-hover/item:text-gold";

export function CommunityDropdown() {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelId = useId();

    useEffect(() => {
        if (!isOpen) return;

        function handlePointerDown(event: PointerEvent) {
            if (!dropdownRef.current?.contains(event.target as Node)) setIsOpen(false);
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsOpen(false);
                triggerRef.current?.focus();
            }
        }

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen]);

    return (
        <div
            ref={dropdownRef}
            className="relative"
            onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setIsOpen(true);
            }}
            onPointerLeave={(event) => {
                if (event.pointerType === "mouse") setIsOpen(false);
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
            }}
        >
            <button
                ref={triggerRef}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setIsOpen((open) => !open)}
                className={triggerClassName}
            >
                Community
                <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <div id={panelId} className="absolute left-1/2 top-full z-70 w-48 -translate-x-1/2 pt-2">
                    <div className="rounded-sm border border-white/10 bg-surface-raised p-1 shadow-2xl">
                        <a href="https://discord.gg/bannerlordcoop" target="_blank" rel="noopener noreferrer" onClick={() => setIsOpen(false)} className={itemClassName}>
                            <span
                                aria-hidden="true"
                                className={`${iconClassName} bg-current`}
                                style={{
                                    WebkitMaskImage: "url('/images/discordlogo.svg')",
                                    maskImage: "url('/images/discordlogo.svg')",
                                    WebkitMaskRepeat: "no-repeat",
                                    maskRepeat: "no-repeat",
                                    WebkitMaskPosition: "center",
                                    maskPosition: "center",
                                    WebkitMaskSize: "contain",
                                    maskSize: "contain",
                                }}
                            />
                            Discord
                        </a>
                        <Link href="/changelog" onClick={() => setIsOpen(false)} className={itemClassName}>
                            <History aria-hidden="true" className={iconClassName} />
                            Changelog
                        </Link>
                        <Link href="/support" onClick={() => setIsOpen(false)} className={itemClassName}>
                            <CircleHelp aria-hidden="true" className={iconClassName} />
                            Support
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
