"use client";

import { Download, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const downloadSources = [
    {
        name: "Guided Installer",
        description: "Windows and Linux. Supporter and Tester nightly: verifies your Discord role or sponsored seat during every install/update. Later server updates download only changed files.",
        href: "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/",
        recommended: true,
        supporterOnly: true,
    },
    {
        name: "Steam Workshop",
        description: "Subscribe and receive updates through Steam.",
        href: "https://steamcommunity.com/sharedfiles/filedetails/?id=3770450698",
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
                className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-sm border border-crimson bg-crimson px-6 py-3 font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors duration-300 hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-13 sm:w-auto sm:px-7 sm:py-3.5 sm:tracking-[0.16em]"
            >
                <Download aria-hidden="true" className="size-4" strokeWidth={1.75} />
                Download The Mod
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
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
                        className="relative max-h-[calc(100svh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-sm border border-white/10 bg-surface-raised shadow-2xl sm:max-h-[calc(100svh-3rem)]"
                    >
                        <div
                            aria-hidden="true"
                            className="absolute inset-x-0 top-0 h-px bg-gold/60"
                        />
                        <div
                            aria-hidden="true"
                            className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(170,151,96,0.08),transparent_45%)]"
                        />

                        <div className="relative p-5 sm:p-9">
                            <button
                                ref={closeButtonRef}
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="absolute top-4 right-4 flex size-10 cursor-pointer items-center justify-center rounded-sm border border-white/15 text-foreground-muted transition-colors duration-300 hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised sm:top-5 sm:right-5"
                                aria-label="Close download options"
                            >
                                <X aria-hidden="true" className="size-5" />
                            </button>

                            <p className="pr-12 font-label text-xs font-semibold uppercase tracking-[0.16em] text-gold sm:pr-14 sm:tracking-[0.2em]">
                                Download Options
                            </p>
                            <h3
                                id="download-modal-heading"
                                className="mt-3 pr-12 font-display text-3xl font-semibold uppercase leading-none text-foreground min-[380px]:text-4xl sm:pr-14 sm:text-5xl"
                            >
                                Choose A Platform
                            </h3>
                            <p
                                id="download-modal-description"
                                className="mt-4 max-w-xl font-sans text-sm leading-6 text-foreground-muted sm:text-base"
                            >
                                Public releases are available below. Nightly builds require the
                                Tester role, a Patreon, Boosty, or Afdian supporter role, or one
                                of an eligible member&apos;s 10 sponsored Discord-account seats.
                            </p>

                            <div className="mt-6 grid gap-3 sm:mt-8">
                                {downloadSources.map((source) => (
                                    <a
                                        key={source.name}
                                        href={source.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group flex items-start justify-between gap-3 rounded-sm border border-white/10 bg-background/60 p-4 text-left transition-colors duration-300 hover:border-gold/50 hover:bg-white/2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised sm:items-center sm:gap-6 sm:p-6"
                                    >
                                        <span>
                                            <span className="flex flex-wrap items-center gap-2 sm:gap-3">
                                                <span className="font-display text-xl font-semibold text-foreground transition-colors duration-300 group-hover:text-gold sm:text-2xl">
                                                    {source.name}
                                                </span>
                                                {"recommended" in source && source.recommended && (
                                                    <span className="rounded-sm border border-crimson/60 px-2 py-1 font-label text-[0.65rem] font-semibold uppercase tracking-widest text-crimson-hover sm:text-xs sm:tracking-[0.12em]">
                                                        Recommended
                                                    </span>
                                                )}
                                                {"supporterOnly" in source && source.supporterOnly && (
                                                    <span className="rounded-sm border border-[#ff8181]/60 px-2 py-1 font-label text-[0.65rem] font-semibold uppercase tracking-widest text-[#ff8181] sm:text-xs sm:tracking-[0.12em]">
                                                        Supporter Only
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
