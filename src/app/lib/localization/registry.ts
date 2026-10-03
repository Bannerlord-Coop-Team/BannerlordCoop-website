import "server-only";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";
import ru from "./locales/ru";
import es from "./locales/es";
import ptBR from "./locales/pt-BR";
import ptPT from "./locales/pt-PT";
import ja from "./locales/ja";
import ko from "./locales/ko";
import de from "./locales/de";
import tr from "./locales/tr";
import fr from "./locales/fr";
import type { Locale, LocaleDefinition, LocaleOption } from "./types";

export const localeDefinitions: Record<Locale, LocaleDefinition> = {
    en, "zh-CN": zhCN, ru, es, "pt-BR": ptBR, "pt-PT": ptPT, ja, ko, de, tr, fr,
};

/** Resolves only explicitly enabled global locales, with English as the default. */
export function resolveLocale(value: string | undefined): Locale {
    if (!value || !Object.hasOwn(localeDefinitions, value)) return "en";
    return localeDefinitions[value as Locale].enabled ? value as Locale : "en";
}

/** Exposes just enabled selector labels, never namespace loaders, to client providers. */
export function getEnabledLocales(): LocaleOption[] {
    return Object.values(localeDefinitions).filter((entry) => entry.enabled)
        .map(({ locale, name }) => ({ locale, name }));
}
