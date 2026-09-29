"use client";

import { signOut } from "@/app/auth/actions";
import { LoadingButton } from "@/app/components/ui/LoadingButton";
import { ChevronDown, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

const itemClassName =
    "block w-full rounded-sm px-4 py-3 text-left font-sans text-sm text-foreground transition-colors hover:bg-white/5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";
const iconItemClassName =
    "flex w-full items-center gap-2 rounded-sm px-4 py-3 text-left font-sans text-sm text-gold transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";

export function ProfileDropdown({ accountName = "Your account", isAdmin = false }: { accountName?: string; isAdmin?: boolean }) {
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
                aria-label={`Account menu for ${accountName}`}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setIsOpen((open) => !open)}
                className="flex min-h-10 items-center justify-center gap-2 px-2.5 lg:px-3 rounded-lg text-foreground transition-colors hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                <UserRound aria-hidden="true" className="size-5 shrink-0" />
                <span className="hidden max-w-28 truncate font-label text-sm leading-none uppercase tracking-widest lg:block">{accountName}</span>
                <ChevronDown aria-hidden="true" className="hidden size-3.5 lg:block" />
            </button>
            {isOpen && (
                <div
                    id={panelId}
                    className="absolute right-0 top-full z-70 mt-3 w-52 rounded-sm border border-white/10 bg-surface-raised p-1 shadow-2xl"
                >
                    <p className="truncate border-b border-white/10 px-4 py-3 text-sm font-semibold text-gold" title={accountName}>{accountName}</p>
                    <Link href="/account" prefetch={false} onClick={() => setIsOpen(false)} className={itemClassName}>
                        Account
                    </Link>
                    <Link href="/servers" prefetch={false} onClick={() => setIsOpen(false)} className={itemClassName}>
                        My Servers
                    </Link>
                    {isAdmin && (
                        <Link href="/admin" onClick={() => setIsOpen(false)} className={iconItemClassName}>
                            <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
                            Admin
                        </Link>
                    )}
                    <hr className="my-1 border-white/10" />
                    <form action={signOut}>
                        <LoadingButton pendingText="Signing out…" className={`${itemClassName} gap-2`}>
                            Sign out
                        </LoadingButton>
                    </form>
                </div>
            )}
        </div>
    );
}
