"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator } from "./translator";
import type { Dictionary, Locale, LocaleOption, Messages, Namespace, Translator } from "./types";

type LocalizationContextValue = {
    locale: Locale;
    enabledLocales: LocaleOption[];
    namespaces: Partial<Record<Namespace, { locale: Locale; dictionary: Dictionary }>>;
};
const LocalizationContext = createContext<LocalizationContextValue | null>(null);

export type LocalizationProviderProps = {
    locale: Locale;
    messages: Messages;
    enabledLocales?: LocaleOption[];
    children: ReactNode;
};

/** Composes page messages without replacing inherited common messages or their locale. */
export function LocalizationProvider({ locale, messages, enabledLocales, children }: LocalizationProviderProps) {
    const parent = useContext(LocalizationContext);
    const value = useMemo(() => ({
        locale: parent?.locale ?? locale,
        enabledLocales: parent?.enabledLocales ?? enabledLocales ?? [],
        namespaces: {
            ...parent?.namespaces,
            ...Object.fromEntries(Object.entries(messages).map(([namespace, dictionary]) => [namespace, { locale, dictionary }])),
        },
    }), [parent, locale, messages, enabledLocales]);
    return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

/** Exposes root locale/selector options without importing any server loaders or cookies. */
export function useLocalization() {
    const context = useContext(LocalizationContext);
    if (!context) throw new Error("LocalizationProvider is required");
    return context;
}

/** Translates a delivered namespace using its own locale, including scoped content overrides. */
export function useTranslations(namespace: Namespace): Translator {
    const { namespaces } = useLocalization();
    const binding = namespaces[namespace];
    if (!binding) throw new Error(`Namespace was not delivered: ${namespace}`);
    return useMemo(() => createTranslator(binding.locale, binding.dictionary), [binding]);
}
