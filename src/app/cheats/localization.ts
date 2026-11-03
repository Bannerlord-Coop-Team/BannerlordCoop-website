import "server-only";
import { getLocale, getMessages } from "@/app/lib/localization/server";
import { localeDefinitions } from "@/app/lib/localization/registry";
import { createTranslator } from "@/app/lib/localization/translator";
import { parseCheatsLocale } from "./locale";

/** Resolves an enabled share-link locale over the site cookie without changing that cookie. */
export async function getCheatsLocalization(value: string | string[] | undefined) {
    const override = parseCheatsLocale(Array.isArray(value) ? value[0] : value);
    const locale = override && localeDefinitions[override].enabled ? override : await getLocale();
    const messages = await getMessages(["cheats"], locale);
    return {
        locale,
        messages,
        translator: createTranslator(locale, messages.cheats!),
        openGraphLocale: localeDefinitions[locale].openGraphLocale,
    };
}
