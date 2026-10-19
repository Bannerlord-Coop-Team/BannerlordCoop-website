import { Fragment } from "react";
import type { Dictionary, Locale, RichSlots, TranslationParams, Translator } from "./types";

const tokenPattern = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/** Returns the named placeholders used by one complete grammatical message. */
export function messageTokens(message: string): string[] {
    return [...new Set([...message.matchAll(tokenPattern)].map((match) => match[1]))].sort();
}

/** Creates a request-independent translator; missing messages/tokens fail rather than falling back. */
export function createTranslator(locale: Locale, dictionary: Dictionary): Translator {
    const plurals = new Intl.PluralRules(locale);

    /** Selects plural forms using only the numeric count parameter. */
    function message(key: string, params: TranslationParams | RichSlots): string {
        if (!Object.hasOwn(dictionary, key)) throw new Error(`Missing translation: ${locale}.${key}`);
        const value = dictionary[key];
        if (typeof value === "string") return value;
        if (typeof params.count !== "number" || !Number.isFinite(params.count)) {
            throw new Error(`Translation requires numeric count: ${key}`);
        }
        return value[plurals.select(params.count)] ?? value.other;
    }

    /** Verifies interpolation inputs without treating their values as executable markup. */
    function assertTokens(text: string, params: TranslationParams | RichSlots): void {
        for (const token of messageTokens(text)) {
            if (!Object.hasOwn(params, token)) throw new Error(`Missing translation token: ${token}`);
        }
    }

    return {
        locale,
        // Interpolates text once, so replacement values cannot introduce new tokens.
        t(key, params = {}) {
            const text = message(key, params);
            assertTokens(text, params);
            return text.replace(tokenPattern, (_, token: string) => String(params[token]));
        },
        // Inserts named React nodes in translation order, never parsing HTML.
        rich(key, slots) {
            const text = message(key, slots);
            assertTokens(text, slots);
            return text.split(tokenPattern).map((part, index) => (
                <Fragment key={index}>{index % 2 ? slots[part] : part}</Fragment>
            ));
        },
        // Formats user-visible numbers with this translator's locale.
        number(value, options) {
            return new Intl.NumberFormat(locale, options).format(value);
        },
        // Defaults to UTC to keep server rendering and hydration deterministic.
        date(value, options) {
            return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(
                typeof value === "string" ? new Date(value) : value,
            );
        },
    };
}
