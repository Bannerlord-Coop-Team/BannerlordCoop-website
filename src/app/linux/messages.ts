import type { Locale } from "@/app/lib/localization/types";
import de from "./content/i18n/de.json";
import en from "./content/i18n/en.json";
import es from "./content/i18n/es.json";
import fr from "./content/i18n/fr.json";
import ja from "./content/i18n/ja.json";
import ko from "./content/i18n/ko.json";
import ptBR from "./content/i18n/pt-BR.json";
import ptPT from "./content/i18n/pt-PT.json";
import ru from "./content/i18n/ru.json";
import tr from "./content/i18n/tr.json";
import zhCN from "./content/i18n/zh-CN.json";

export type GuidePack = {
    title: string;
    description: string;
    strings: Record<string, string>;
    rich: Record<string, string>;
    nav: Record<string, string>;
};

const packs: Record<Locale, GuidePack> = {
    en: en as GuidePack,
    "zh-CN": zhCN as GuidePack,
    ru: ru as GuidePack,
    es: es as GuidePack,
    "pt-BR": ptBR as GuidePack,
    "pt-PT": ptPT as GuidePack,
    ja: ja as GuidePack,
    ko: ko as GuidePack,
    de: de as GuidePack,
    tr: tr as GuidePack,
    fr: fr as GuidePack,
};

/** Guide copy stays in its own packs. The site locale only selects which pack to deliver. */
export function guidePack(locale: Locale): GuidePack {
    return packs[locale] ?? packs.en;
}
