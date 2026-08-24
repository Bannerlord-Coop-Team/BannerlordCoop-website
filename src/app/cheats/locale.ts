export const CHEATS_LOCALES = ["en", "zh-CN"] as const;

export type CheatsLocale = (typeof CHEATS_LOCALES)[number];

export const DEFAULT_CHEATS_LOCALE: CheatsLocale = "en";
export const CHEATS_LOCALE_STORAGE_KEY = "bannerlordcoop.cheats.lang";
export const CHEATS_LOCALE_COOKIE = "cheats-locale";

export type CheatsRichPart = { text: string } | { code: string };

export type CheatsUi = {
    metadataTitle: string;
    metadataDescription: string;
    eyebrow: string;
    title: string;
    intro: string;
    commandsStat: string;
    serverStat: string;
    clientStat: string;
    consoleTip: string;
    vanillaCampaignWarning: CheatsRichPart[];
    directoryEyebrow: string;
    directoryTitle: string;
    categories: string;
    featured: string;
    allCheats: string;
    searchLabel: string;
    searchPlaceholder: string;
    clearSearch: string;
    copySearchLink: string;
    copiedLink: string;
    shown: (count: number) => string;
    type: string;
    side: string;
    kindAll: string;
    kindGameplay: string;
    kindInspect: string;
    sideAll: string;
    sideServer: string;
    sideClient: string;
    sideEither: string;
    kindAction: string;
    kindAudit: string;
    kindInspectBadge: string;
    kindFixture: string;
    findingIdsTitle: string;
    findingIdsParagraphs: CheatsRichPart[][];
    empty: string;
    copyLink: string;
    copy: string;
    copied: string;
    categoriesNav: string;
    language: string;
    languageEnglish: string;
    languageChinese: string;
};

export type CheatsCommandOverlay = {
    name: string;
    summary: string;
};

export type CheatsMessages = {
    ui: CheatsUi;
    categories: Record<string, string>;
    featured: Record<string, string>;
    commands: Record<string, CheatsCommandOverlay>;
};

export function parseCheatsLocale(value: string | undefined): CheatsLocale {
    const normalized = value?.trim().toLowerCase().replace(/_/g, "-");
    if (
        normalized === "zh"
        || normalized === "zh-cn"
        || normalized === "zh-hans"
        || normalized === "zh-hans-cn"
        || normalized === "cn"
    ) {
        return "zh-CN";
    }

    return "en";
}

export function cheatsLabelClass(locale: CheatsLocale, kind: "eyebrow" | "nav" | "filter" | "badge" | "button") {
    if (locale === "zh-CN") {
        if (kind === "eyebrow") return "font-label text-xs font-semibold text-gold";
        if (kind === "nav") return "font-label text-sm font-semibold leading-5";
        if (kind === "filter") return "font-label text-[0.75rem] font-semibold";
        if (kind === "badge") return "font-label text-[0.7rem] font-semibold leading-4";
        return "font-label text-xs font-semibold";
    }

    if (kind === "eyebrow") return "font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold";
    if (kind === "nav") return "font-label text-xs font-semibold uppercase leading-4 tracking-[0.08em]";
    if (kind === "filter") return "font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em]";
    if (kind === "badge") return "font-label text-[0.65rem] font-semibold uppercase leading-4 tracking-[0.08em]";
    return "font-label text-xs font-semibold uppercase tracking-[0.08em]";
}
