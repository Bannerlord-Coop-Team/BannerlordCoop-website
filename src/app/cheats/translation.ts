import type { Translator } from "@/app/lib/localization/types";

/**
 * Keeps catalog-driven pages renderable while a newly published command is
 * waiting for its locale entry. The source catalog remains the authoritative
 * fallback for command syntax and English explanatory text.
 */
export function translateCheat(
    translate: Translator["t"],
    key: string,
    fallback: string,
) {
    try {
        return translate(key);
    } catch {
        return fallback;
    }
}
