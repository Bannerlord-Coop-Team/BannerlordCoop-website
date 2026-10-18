import type { Locale } from "./types";

/** Preserves route/query/hash, replacing only a cheats content override after explicit selection. */
export function localeNavigationTarget(href: string, locale: Locale): string {
    const url = new URL(href);
    if (url.pathname === "/cheats" || url.pathname === "/cheats/") {
        url.searchParams.delete("lang");
        if (locale !== "en") url.searchParams.set("lang", locale);
    }
    return `${url.pathname}${url.search}${url.hash}`;
}
