"use client";

import { CheatsDirectory, type CheatCommand } from "@/app/cheats/CheatsDirectory";
import {
    CHEATS_LOCALE_COOKIE,
    CHEATS_LOCALE_STORAGE_KEY,
    cheatsLabelClass,
    parseCheatsLocale,
    type CheatsLocale,
} from "@/app/cheats/locale";
import { getCheatsMessages } from "@/app/cheats/locales";
import type { CheatsQuery } from "@/app/cheats/query";
import {
    CircleAlert,
    Keyboard,
    Monitor,
    Server,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function CheatsView({
    commands,
    initialQuery,
}: {
    commands: readonly CheatCommand[];
    initialQuery: CheatsQuery;
}) {
    const [locale, setLocale] = useState<CheatsLocale>(initialQuery.lang);
    const [localeReady, setLocaleReady] = useState(false);
    const messages = useMemo(() => getCheatsMessages(locale), [locale]);
    const { ui } = messages;
    const serverCount = commands.filter((command) => command.side === "server").length;
    const clientCount = commands.filter((command) => command.side === "client").length;

    useEffect(() => {
        const urlHasLang = new URLSearchParams(window.location.search).has("lang");
        if (!urlHasLang) {
            const cookie = document.cookie.match(new RegExp(`(?:^|; )${CHEATS_LOCALE_COOKIE}=([^;]*)`))?.[1];
            const stored = cookie || window.localStorage.getItem(CHEATS_LOCALE_STORAGE_KEY);
            if (stored) setLocale(parseCheatsLocale(decodeURIComponent(stored)));
        }
        setLocaleReady(true);
    }, []);

    useEffect(() => {
        if (!localeReady) return;
        window.localStorage.setItem(CHEATS_LOCALE_STORAGE_KEY, locale);
        document.cookie = `${CHEATS_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    }, [locale, localeReady]);

    useEffect(() => {
        function onPopState() {
            const params = Object.fromEntries(new URLSearchParams(window.location.search));
            setLocale(parseCheatsLocale(params.lang));
        }

        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, []);

    return (
        <main className="min-h-svh bg-background" lang={locale}>
            <div className="site-container py-10 sm:py-14">
                <section className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end" aria-labelledby="cheats-heading">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <p className={cheatsLabelClass(locale, "eyebrow")}>
                                {ui.eyebrow}
                            </p>
                            <CheatsLocaleSwitcher
                                locale={locale}
                                languageLabel={ui.language}
                                englishLabel={ui.languageEnglish}
                                chineseLabel={ui.languageChinese}
                                onChange={setLocale}
                            />
                        </div>
                        <h1 id="cheats-heading" className={`mt-3 text-4xl font-semibold text-foreground sm:text-5xl ${locale === "zh-CN" ? "font-sans" : "font-display"}`}>
                            {ui.title}
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted sm:text-base">
                            {ui.intro}
                        </p>
                    </div>

                    <dl className="grid grid-cols-3 border border-white/10 bg-surface">
                        <DirectoryStat locale={locale} icon={Keyboard} label={ui.commandsStat} value={commands.length} />
                        <DirectoryStat locale={locale} icon={Server} label={ui.serverStat} value={serverCount} />
                        <DirectoryStat locale={locale} icon={Monitor} label={ui.clientStat} value={clientCount} />
                    </dl>
                </section>

                <div className="mt-8 flex gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3.5 text-sm text-foreground-muted">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                    <p>
                        <strong className="font-semibold text-foreground">{ui.consoleTip}</strong>
                    </p>
                </div>

                <section className="mt-12 min-w-0 overflow-x-clip" aria-labelledby="cheat-directory-heading">
                    <div className="mb-5">
                        <p className={`${cheatsLabelClass(locale, "eyebrow")} text-[0.65rem]`}>
                            {ui.directoryEyebrow}
                        </p>
                        <h2 id="cheat-directory-heading" className={`mt-2 text-3xl font-semibold text-foreground sm:text-4xl ${locale === "zh-CN" ? "font-sans" : "font-display"}`}>
                            {ui.directoryTitle}
                        </h2>
                    </div>
                    <CheatsDirectory
                        commands={commands}
                        initialQuery={initialQuery}
                        locale={locale}
                        messages={messages}
                    />
                </section>
            </div>
        </main>
    );
}

function CheatsLocaleSwitcher({
    locale,
    languageLabel,
    englishLabel,
    chineseLabel,
    onChange,
}: {
    locale: CheatsLocale;
    languageLabel: string;
    englishLabel: string;
    chineseLabel: string;
    onChange: (locale: CheatsLocale) => void;
}) {
    const options = [
        { id: "en" as const, label: englishLabel },
        { id: "zh-CN" as const, label: chineseLabel },
    ];

    return (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={languageLabel}>
            {options.map((option) => {
                const isActive = option.id === locale;
                return (
                    <button
                        key={option.id}
                        type="button"
                        onClick={() => onChange(option.id)}
                        className={
                            isActive
                                ? "inline-flex min-h-8 items-center border border-gold/60 bg-gold/15 px-3 font-label text-[0.75rem] font-semibold text-gold"
                                : "inline-flex min-h-8 items-center border border-white/10 bg-background px-3 font-label text-[0.75rem] font-semibold text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold"
                        }
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

function DirectoryStat({
    locale,
    icon: Icon,
    label,
    value,
}: {
    locale: CheatsLocale;
    icon: typeof Server;
    label: string;
    value: number;
}) {
    return (
        <div className="min-w-24 border-r border-white/10 px-4 py-3 last:border-r-0 sm:min-w-32 sm:px-5">
            <dt className={`flex items-center gap-1.5 text-foreground-muted ${cheatsLabelClass(locale, "badge")}`}>
                <Icon aria-hidden="true" className="size-3.5 text-gold-muted" />
                {label}
            </dt>
            <dd className="mt-1.5 font-display text-2xl font-semibold leading-none text-foreground">
                {value}
            </dd>
        </div>
    );
}
