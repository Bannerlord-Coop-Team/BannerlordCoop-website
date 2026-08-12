"use client";

import { signOut } from "@/app/auth/actions";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const navigation = [
    { label: "Home", href: "/" },
    { label: "Wiki", href: "/wiki" },
    { label: "Changelog", href: "/changelog" },
    { label: "Support", href: "/support" },
] as const;

export function MobileNavigation({
    hasServerAccess,
    isAdmin,
    isAuthenticated,
}: {
    hasServerAccess: boolean;
    isAdmin: boolean;
    isAuthenticated: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const shouldReduceMotion = useReducedMotion();

    useEffect(() => {
        if (!isOpen) return;

        const trigger = triggerRef.current;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        function closeMenu() {
            setIsOpen(false);
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") closeMenu();
        }

        const desktopMedia = window.matchMedia("(min-width: 1024px)");
        desktopMedia.addEventListener("change", closeMenu);
        document.addEventListener("keydown", handleKeyDown);
        menuRef.current?.querySelector<HTMLElement>("a")?.focus();

        return () => {
            document.body.style.overflow = previousOverflow;
            desktopMedia.removeEventListener("change", closeMenu);
            document.removeEventListener("keydown", handleKeyDown);
            trigger?.focus();
        };
    }, [isOpen]);

    function closeMenu() {
        setIsOpen(false);
    }

    return (
        <div className="lg:hidden">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                className="relative z-60 flex size-10 items-center justify-center rounded-full border border-white/20 text-foreground transition-colors duration-300 hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={isOpen}
                aria-controls="mobile-navigation"
            >
                <span aria-hidden="true" className="relative block size-5">
                    <span
                        className={`absolute left-0 h-px w-5 bg-current transition-[top,transform] duration-300 ease-out ${
                            isOpen ? "top-2.5 rotate-45" : "top-1"
                        }`}
                    />
                    <span
                        className={`absolute top-2.5 left-0 h-px w-5 bg-current transition-[opacity,transform] duration-200 ease-out ${
                            isOpen ? "scale-x-0 opacity-0" : "scale-x-100 opacity-100"
                        }`}
                    />
                    <span
                        className={`absolute left-0 h-px w-5 bg-current transition-[top,transform] duration-300 ease-out ${
                            isOpen ? "top-2.5 -rotate-45" : "top-4"
                        }`}
                    />
                </span>
            </button>

            <AnimatePresence>
                {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
                    onMouseDown={(event) => {
                        if (event.currentTarget === event.target) closeMenu();
                    }}
                >
                    <motion.div
                        ref={menuRef}
                        id="mobile-navigation"
                        initial={{ x: shouldReduceMotion ? 0 : "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: shouldReduceMotion ? 0 : "100%" }}
                        transition={{
                            duration: shouldReduceMotion ? 0 : 0.4,
                            ease: [0.22, 1, 0.36, 1],
                        }}
                        className="ml-auto flex h-full w-full max-w-sm flex-col border-l border-white/10 bg-surface-raised p-6 shadow-2xl sm:p-8"
                    >
                        <div className="border-b border-white/10 pb-5 pr-12">
                            <p className="font-display text-xl font-semibold uppercase tracking-[0.08em] text-foreground">
                                Bannerlord Coop
                            </p>
                        </div>

                        <nav className="mt-8" aria-label="Mobile navigation">
                            <ul className="space-y-1">
                                {navigation.map((item) => (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            onClick={closeMenu}
                                            className="block border-b border-white/10 py-4 font-display text-3xl font-semibold uppercase text-foreground transition-colors hover:text-gold focus-visible:outline-none"
                                        >
                                            {item.label}
                                        </Link>
                                    </li>
                                ))}
                                {hasServerAccess && (
                                    <li>
                                        <Link
                                            href="/servers"
                                            onClick={closeMenu}
                                            className="block border-b border-white/10 py-4 font-display text-3xl font-semibold uppercase text-gold transition-colors hover:text-foreground focus-visible:outline-none"
                                        >
                                            Servers
                                        </Link>
                                    </li>
                                )}
                                {isAdmin && (
                                    <li>
                                        <Link
                                            href="/admin"
                                            onClick={closeMenu}
                                            className="block border-b border-white/10 py-4 font-display text-3xl font-semibold uppercase text-gold transition-colors hover:text-foreground focus-visible:outline-none"
                                        >
                                            Admin
                                        </Link>
                                    </li>
                                )}
                            </ul>
                        </nav>

                        <div className="mt-auto grid gap-3 pt-8">
                            <a
                                href="https://discord.gg/bannerlordcoop"
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={closeMenu}
                                className="inline-flex min-h-12 items-center justify-center rounded-sm border border-white/20 font-label text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:border-gold/60 hover:text-gold"
                            >
                                Discord
                            </a>
                            <a
                                href="#download"
                                onClick={closeMenu}
                                className="inline-flex min-h-12 items-center justify-center rounded-sm border border-crimson bg-crimson font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover"
                            >
                                Download
                            </a>
                            {isAuthenticated ? (
                                <form action={signOut} onSubmit={closeMenu}>
                                    <button
                                        type="submit"
                                        className="inline-flex min-h-12 w-full items-center justify-center rounded-sm border border-crimson bg-transparent font-label text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:border-crimson-hover hover:bg-crimson/15 hover:text-white"
                                    >
                                        Log out
                                    </button>
                                </form>
                            ) : (
                                <Link
                                    href="/login"
                                    onClick={closeMenu}
                                    className="inline-flex min-h-12 items-center justify-center rounded-sm border border-crimson bg-transparent font-label text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:border-crimson-hover hover:bg-crimson/15 hover:text-white"
                                >
                                    Sign in
                                </Link>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}