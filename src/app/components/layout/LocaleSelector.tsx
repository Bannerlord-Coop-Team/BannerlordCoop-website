"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { setLocale } from "@/app/lib/localization/actions";
import { useLocalization, useTranslations } from "@/app/lib/localization/client";
import { localeNavigationTarget } from "@/app/lib/localization/navigation";
import type { Locale } from "@/app/lib/localization/types";
import { LocaleFlag } from "./LocaleFlag";

const triggerClassName = {
    desktop: "inline-flex min-h-10 max-w-52 items-center gap-2 rounded-sm border border-white/20 bg-background px-2.5 text-sm text-foreground transition-colors hover:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
    mobile: "flex min-h-12 w-full items-center gap-3 rounded-sm border border-white/20 bg-background px-4 text-sm text-foreground transition-colors hover:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
};
const panelClassName = {
    desktop: "absolute right-0 top-full z-70 w-60 pt-2",
    mobile: "absolute inset-x-0 bottom-full z-70 pb-2",
};

/** Offers keyboard-accessible flagged locale choices and retains the current route and anchor. */
export function LocaleSelector({ variant }: { variant: "desktop" | "mobile" }) {
    const { locale, enabledLocales } = useLocalization();
    const { t } = useTranslations("common");
    const router = useRouter();
    const id = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const [failed, setFailed] = useState(false);
    const current = enabledLocales.find((option) => option.locale === locale) ?? { locale, name: locale };

    useEffect(() => {
        if (!isOpen) return;
        // Closes the list when a pointer interaction starts outside this selector.
        function handlePointerDown(event: PointerEvent) {
            if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
        }
        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [isOpen]);

    /** Saves the preference before refreshing server-rendered metadata, chrome, and page content. */
    function selectLocale(value: Locale) {
        setIsOpen(false);
        triggerRef.current?.focus();
        setFailed(false);
        startTransition(async () => {
            try {
                const selected = await setLocale(value);
                const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                const target = localeNavigationTarget(window.location.href, selected);
                if (target !== currentPath) router.replace(target, { scroll: false });
                router.refresh();
            } catch {
                setFailed(true);
            }
        });
    }

    return (
        <div
            ref={rootRef}
            className="relative min-w-0"
            data-locale-selector={variant}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
            }}
            onKeyDown={(event) => {
                if (event.key !== "Escape" || !isOpen) return;
                // Keeps Escape from also closing the surrounding mobile drawer.
                event.stopPropagation();
                setIsOpen(false);
                triggerRef.current?.focus();
            }}
        >
            <span id={`${id}-label`} className="sr-only">{t("locale.label")}</span>
            <button
                ref={triggerRef}
                type="button"
                aria-labelledby={`${id}-label ${id}-value`}
                aria-expanded={isOpen}
                aria-controls={`${id}-options`}
                aria-busy={pending || undefined}
                aria-describedby={failed ? `${id}-error` : undefined}
                onClick={() => setIsOpen((open) => !open)}
                className={triggerClassName[variant]}
            >
                <LocaleFlag locale={current.locale} />
                <span id={`${id}-value`} lang={current.locale} className="min-w-0 flex-1 truncate text-left">{current.name}</span>
                <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
            </button>
            <div id={`${id}-options`} hidden={!isOpen} className={panelClassName[variant]}>
                <ul aria-labelledby={`${id}-label`} className="rounded-sm border border-white/10 bg-surface-raised p-1 shadow-2xl">
                    {enabledLocales.map((option) => (
                        <li key={option.locale}>
                            <button
                                type="button"
                                lang={option.locale}
                                disabled={pending}
                                aria-current={option.locale === locale || undefined}
                                onClick={() => selectLocale(option.locale)}
                                className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm text-foreground-muted transition-colors hover:bg-white/5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold aria-[current=true]:text-foreground"
                            >
                                <LocaleFlag locale={option.locale} />
                                <span className="min-w-0 flex-1">{option.name}</span>
                                {option.locale === locale && <Check aria-hidden="true" className="size-4 shrink-0 text-gold" />}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
            {pending && <span role="status" className="sr-only">{t("locale.saving")}</span>}
            {failed && <p id={`${id}-error`} role="alert" className="text-sm text-foreground">{t("locale.error")}</p>}
        </div>
    );
}
