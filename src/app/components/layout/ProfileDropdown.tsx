"use client";

import { signOut } from "@/app/auth/actions";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

const itemClassName =
    "block w-full rounded-sm px-4 py-3 text-left font-sans text-sm text-foreground transition-colors hover:bg-white/5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";

export function ProfileDropdown() {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelId = useId();

    useEffect(() => {
        if (!isOpen) return;

        function handlePointerDown(event: PointerEvent) {
            if (!dropdownRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
            }
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
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    setIsOpen(false);
                }
            }}
        >
            <button
                ref={triggerRef}
                type="button"
                aria-label="Profile"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setIsOpen((open) => !open)}
                className="flex size-10 items-center justify-center rounded-full border border-white/20 text-foreground transition-colors hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                <UserRound aria-hidden="true" className="size-5" />
            </button>
            {isOpen && (
                <div
                    id={panelId}
                    className="absolute right-0 top-full z-70 mt-3 w-52 rounded-sm border border-white/10 bg-surface-raised p-1 shadow-2xl"
                >
                    <Link href="/account" prefetch={false} onClick={() => setIsOpen(false)} className={itemClassName}>
                        Account
                    </Link>
                    <Link href="/account#link-account" prefetch={false} onClick={() => setIsOpen(false)} className={itemClassName}>
                        Link account
                    </Link>
                    <hr className="my-1 border-white/10" />
                    <form action={signOut} onSubmit={() => setIsOpen(false)}>
                        <button type="submit" className={itemClassName}>
                            Logout
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
}
