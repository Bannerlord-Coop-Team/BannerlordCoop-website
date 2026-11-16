"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createTranslator } from "./translator";
import type { Dictionary, Locale, LocaleOption, Messages, Namespace, PluralMessage, Translator } from "./types";

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
    const messages = useStableMessages(locale, deliveredMessages);
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
function useStableMessages(locale: Locale, delivered: Messages): Messages {
    const [stable, setStable] = useState({ locale, delivered, messages: delivered });
    if (stable.delivered === delivered && stable.locale === locale) return stable.messages;
    const messages = stable.locale === locale ? reuseDictionaries(stable.messages, delivered) : delivered;
    setStable({ locale, delivered, messages });
    return messages;
}

/** Substitutes each unchanged namespace's earlier dictionary, returning the earlier messages when nothing changed. */
function reuseDictionaries(previous: Messages, next: Messages): Messages {
    const merged = Object.fromEntries(Object.entries(next).map(([namespace, dictionary]) => {
        const earlier = previous[namespace as Namespace];
        return [namespace, earlier && sameDictionary(earlier, dictionary) ? earlier : dictionary];
    })) as Messages;
    const unchanged = Object.keys(previous).length === Object.keys(merged).length
        && Object.entries(merged).every(([namespace, dictionary]) => previous[namespace as Namespace] === dictionary);
    return unchanged ? previous : merged;
}

/** Compares two dictionaries by their messages rather than by object identity. */
function sameDictionary(left: Dictionary, right: Dictionary): boolean {
    if (left === right) return true;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => Object.hasOwn(right, key) && sameMessage(left[key], right[key]));
}

/** Compares one plain or plural message by value. */
function sameMessage(left: string | PluralMessage, right: string | PluralMessage): boolean {
    if (typeof left === "string" || typeof right === "string") return left === right;
    const forms = Object.keys(left) as (keyof PluralMessage)[];
    return forms.length === Object.keys(right).length && forms.every((form) => left[form] === right[form]);
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
