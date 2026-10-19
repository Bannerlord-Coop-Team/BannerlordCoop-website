import { messageTokens } from "./translator";
import type { Dictionary } from "./types";

const pluralCategories = new Set(["zero", "one", "two", "few", "many", "other"]);

/** Validates flat message data and consistent placeholders in every plural form. */
export function validateDictionary(dictionary: Dictionary, label: string): void {
    if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) {
        throw new Error(`Invalid dictionary: ${label}`);
    }
    for (const [key, value] of Object.entries(dictionary)) {
        if (typeof value === "string") continue;
        if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.other !== "string") {
            throw new Error(`Plural requires other: ${label}.${key}`);
        }
        const tokens = messageTokens(value.other).join(",");
        for (const [category, text] of Object.entries(value)) {
            if (!pluralCategories.has(category) || typeof text !== "string") {
                throw new Error(`Invalid plural form: ${label}.${key}.${category}`);
            }
            if (messageTokens(text).join(",") !== tokens) {
                throw new Error(`Plural tokens differ: ${label}.${key}.${category}`);
            }
        }
    }
}

/** Enforces exact keys, message kinds, and named tokens, but permits locale-specific plural categories. */
export function assertDictionaryParity(english: Dictionary, translated: Dictionary, label: string): void {
    validateDictionary(english, "en");
    validateDictionary(translated, label);
    if (Object.keys(english).sort().join("\n") !== Object.keys(translated).sort().join("\n")) {
        throw new Error(`Dictionary keys differ: ${label}`);
    }
    for (const key of Object.keys(english)) {
        const source = english[key];
        const target = translated[key];
        if (typeof source !== typeof target) throw new Error(`Message kind differs: ${label}.${key}`);
        const sourceTokens = messageTokens(typeof source === "string" ? source : source.other).join(",");
        const forms = typeof target === "string" ? [target] : Object.values(target);
        if (forms.some((form) => messageTokens(form).join(",") !== sourceTokens)) {
            throw new Error(`Translation tokens differ: ${label}.${key}`);
        }
    }
}
