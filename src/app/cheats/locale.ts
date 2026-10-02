import { locales, type Locale } from "@/app/lib/localization/types";

/** Parses explicit share-link locales, including the existing Simplified Chinese aliases. */
export function parseCheatsLocale(value: string | undefined): Locale | undefined {
    const normalized = value?.trim().toLowerCase().replace(/_/g, "-");
    if (["zh", "zh-cn", "zh-hans", "zh-hans-cn", "cn"].includes(normalized ?? "")) return "zh-CN";
    return locales.find((locale) => locale.toLowerCase() === normalized);
}

/** Keeps compact directory labels readable without a per-language rendering branch. */
export function cheatsLabelClass(kind: "eyebrow" | "nav" | "filter" | "badge" | "button") {
    if (kind === "eyebrow") return "font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold [&:lang(zh-CN)]:tracking-normal [&:lang(zh-CN)]:normal-case";
    if (kind === "nav") return "font-label text-xs font-semibold uppercase leading-4 tracking-[0.08em] [&:lang(zh-CN)]:text-sm [&:lang(zh-CN)]:leading-5 [&:lang(zh-CN)]:tracking-normal [&:lang(zh-CN)]:normal-case";
    if (kind === "filter") return "font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] [&:lang(zh-CN)]:text-[0.75rem] [&:lang(zh-CN)]:tracking-normal [&:lang(zh-CN)]:normal-case";
    if (kind === "badge") return "font-label text-[0.65rem] font-semibold uppercase leading-4 tracking-[0.08em] [&:lang(zh-CN)]:text-[0.7rem] [&:lang(zh-CN)]:tracking-normal [&:lang(zh-CN)]:normal-case";
    return "font-label text-xs font-semibold uppercase tracking-[0.08em] [&:lang(zh-CN)]:tracking-normal [&:lang(zh-CN)]:normal-case";
}
