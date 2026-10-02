"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocale } from "@/app/lib/localization/actions";
import { useLocalization, useTranslations } from "@/app/lib/localization/client";
import { localeNavigationTarget } from "@/app/lib/localization/navigation";

/** Offers native keyboard-accessible locale selection and retains the current route and anchor. */
export function LocaleSelector({ variant }: { variant: "desktop" | "mobile" }) {
    const { locale, enabledLocales } = useLocalization();
    const { t } = useTranslations("common");
    const router = useRouter();
    const id = useId();
    const [pending, startTransition] = useTransition();
    const [failed, setFailed] = useState(false);

    /** Saves the preference before refreshing server-rendered metadata, chrome, and page content. */
    function selectLocale(value: string) {
        setFailed(false);
        startTransition(async () => {
            try {
                const selected = await setLocale(value);
                const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                const target = localeNavigationTarget(window.location.href, selected);
                if (target !== current) router.replace(target, { scroll: false });
                router.refresh();
            } catch {
                setFailed(true);
            }
        });
    }

    return (
        <div className="min-w-0" data-locale-selector={variant}>
            <label htmlFor={id} className="sr-only">{t("locale.label")}</label>
            <select
                id={id}
                value={locale}
                disabled={pending}
                aria-busy={pending || undefined}
                aria-describedby={failed ? `${id}-error` : undefined}
                onChange={(event) => selectLocale(event.target.value)}
                className="min-h-10 max-w-40 rounded-sm border border-white/20 bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
                {enabledLocales.map((option) => <option key={option.locale} value={option.locale}>{option.name}</option>)}
            </select>
            <button
                type="button"
                disabled={pending}
                onClick={() => selectLocale(locale)}
                className="ml-1 min-h-10 rounded-sm px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
                {t("locale.apply")}
            </button>
            {pending && <span role="status" className="sr-only">{t("locale.saving")}</span>}
            {failed && <p id={`${id}-error`} role="alert" className="text-sm text-foreground">{t("locale.error")}</p>}
        </div>
    );
}
