import "server-only";
import { getLocale, getMessages } from "@/app/lib/localization/server";
import { localeDefinitions } from "@/app/lib/localization/registry";
import { createTranslator } from "@/app/lib/localization/translator";
import { parseCheatsLocale } from "./locale";

/** Resolves scoped share links without changing the site's cookie or activating Chinese globally. */
export async function getCheatsLocalization(value: string | string[] | undefined) {
    const override = parseCheatsLocale(Array.isArray(value) ? value[0] : value);
    const globalLocale = await getLocale();
    const locale = override && (override === "zh-CN" || localeDefinitions[override].enabled)
        ? override : globalLocale;
    const messages = locale === "zh-CN" && !localeDefinitions[locale].enabled
        ? { cheats: (await import("./locales/zh-CN.json")).default }
        : await getMessages(["cheats"], locale);
    return {
        locale,
        messages,
        translator: createTranslator(locale, messages.cheats!),
        openGraphLocale: localeDefinitions[locale].openGraphLocale,
    };
}
