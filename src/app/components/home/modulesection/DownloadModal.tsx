"use client";

import { Download, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const downloadSources = [
    {
        name: "Steam Workshop",
        description: "Subscribe and receive updates through Steam.",
        href: "https://steamcommunity.com/sharedfiles/filedetails/?id=3770450698",
        recommended: true,
    },
    {
        name: "Nexus Mods",
        description: "Download Bannerlord Coop from Nexus Mods.",
        href: "https://www.nexusmods.com/mountandblade2bannerlord/mods/2387",
    },
    {
        name: "ModDB",
        description: "View releases and project updates on ModDB.",
        href: "https://www.moddb.com/mods/bannerlord-coop",
    },
] as const;

export function DownloadModal() {
    const [isOpen, setIsOpen] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const openButtonRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const previousOverflow = document.body.style.overflow;
        const openButton = openButtonRef.current;
        document.body.style.overflow = "hidden";
        closeButtonRef.current?.focus();

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsOpen(false);
                return;
            }

            if (event.key !== "Tab" || !dialogRef.current) {
                return;
            }

            const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            );
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (event.shiftKey && document.activeElement === firstElement) {
                event.preventDefault();
                lastElement?.focus();
            } else if (!event.shiftKey && document.activeElement === lastElement) {
                event.preventDefault();
                firstElement?.focus();
            }
        }

        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", handleKeyDown);
            openButton?.focus();
        };
    }, [isOpen]);

    return (
        <>
            <button
                ref={openButtonRef}
                type="button"
                onClick={() => setIsOpen(true)}
                className="inline-flex gap-2 cursor-pointer border border-crimson bg-crimson px-7 py-3.5 rounded-sm font-label text-sm font-semibold uppercase tracking-[0.16em] text-white transition-colors duration-300 hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                <Download aria-hidden="true" className="size-4" strokeWidth={1.75} />
                Download The Mod
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-6"
                    onMouseDown={(event) => {
                        if (event.currentTarget === event.target) {
                            setIsOpen(false);
                        }
                    }}
                >
                    <div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="download-modal-heading"
                        aria-describedby="download-modal-description"
                        className="relative max-h-full w-full max-w-2xl overflow-y-auto border border-white/10 bg-surface-raised shadow-2xl rounded-sm"
                    >
                        <div
                            aria-hidden="true"
                            className="absolute inset-x-0 top-0 h-px bg-gold/60"
                        />
                        <div
                            aria-hidden="true"
                            className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(170,151,96,0.08),transparent_45%)]"
                        />

                        <div className="relative p-6 sm:p-9">
                            <button
                                ref={closeButtonRef}
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="absolute cursor-pointer rounded-sm top-5 right-5 flex size-10 items-center justify-center border border-white/15 text-foreground-muted transition-colors duration-300 hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                                aria-label="Close download options"
                            >
                                <X aria-hidden="true" className="size-5" />
                            </button>

                            <p className="pr-14 font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                                Download Options
                            </p>
                            <h3
                                id="download-modal-heading"
                                className="mt-3 pr-14 font-display text-4xl font-semibold uppercase leading-none text-foreground sm:text-5xl"
                            >
                                Choose A Platform
                            </h3>
                            <p
                                id="download-modal-description"
                                className="mt-4 max-w-xl font-sans text-sm leading-6 text-foreground-muted sm:text-base"
                            >
                                Select your preferred source. Make sure every player
                                uses the same version of Bannerlord Coop.
                            </p>

                            <div className="mt-8 grid gap-3 ">
                                {downloadSources.map((source) => (
                                    <a
                                        key={source.name}
                                        href={source.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group flex items-center rounded-sm justify-between gap-6 border border-white/10 bg-background/60 p-5 text-left transition-colors duration-300 hover:border-gold/50 hover:bg-white/2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised sm:p-6"
                                    >
                                        <span>
                                            <span className="flex items-center gap-3">
                                                <span className="font-display text-2xl font-semibold text-foreground transition-colors duration-300 group-hover:text-gold">
                                                    {source.name}
                                                </span>
                                                {"recommended" in source && source.recommended && (
                                                    <span className="border border-crimson/60 px-2 py-1 font-label text-xs font-semibold uppercase tracking-[0.12em] text-crimson-hover rounded-sm">
                                                        Recommended
                                                    </span>
                                                )}
                                            </span>
                                            <span className="mt-2 block font-sans text-sm leading-5 text-foreground-muted">
                                                {source.description}
                                            </span>
                                        </span>
                                        <ExternalLink
                                            aria-hidden="true"
                                            className="size-5 shrink-0 text-foreground-dim transition-colors duration-300 group-hover:text-gold"
                                        />
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}