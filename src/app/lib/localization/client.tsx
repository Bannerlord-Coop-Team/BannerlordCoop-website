"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { reuseDictionaries } from "./dictionary-reuse";
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
export function LocalizationProvider({ locale, messages: deliveredMessages, enabledLocales, children }: LocalizationProviderProps) {
    const parent = useContext(LocalizationContext);
    const messages = useStableMessages(deliveredMessages);
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

/** Keeps earlier dictionaries when a refresh re-delivers identical content, so translators keep their identity. */
function useStableMessages(delivered: Messages): Messages {
    const [stable, setStable] = useState({ delivered, messages: delivered });
    if (stable.delivered === delivered) return stable.messages;
    // Adjusts state during render so this render already uses the reused dictionaries, without an extra effect pass.
    const messages = reuseDictionaries(stable.messages, delivered);
    setStable({ delivered, messages });
    return messages;
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
    const { locale, dictionary } = binding;
    // Keyed by content-stable parts, so a re-composed context does not hand effects a new translator.
    return useMemo(() => createTranslator(locale, dictionary), [locale, dictionary]);
}
