import { FEATURED_TAB } from "@/app/cheats/featured";
import { parseCheatsLocale } from "@/app/cheats/locale";
import type { Locale } from "@/app/lib/localization/types";

export type CheatKindFilter = "all" | "gameplay" | "inspect";
export type CheatSideFilter = "all" | "server" | "client" | "either";

export type CheatsQuery = {
    q: string;
    tab: string;
    type: CheatKindFilter;
    side: CheatSideFilter;
    cheat: string | null;
    lang?: Locale;
};

type QueryInput = {
    q?: string | string[];
    tab?: string | string[];
    type?: string | string[];
    side?: string | string[];
    cheat?: string | string[];
    lang?: string | string[];
};

/** Reads the first value of repeated directory query parameters. */
function first(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value[0];
    return value;
}

/** Restricts command-kind filters to their existing URL values. */
function parseKind(value: string | undefined): CheatKindFilter {
    if (value === "gameplay" || value === "inspect") return value;
    return "all";
}

/** Restricts execution-side filters to their existing URL values. */
function parseSide(value: string | undefined): CheatSideFilter {
    if (value === "server" || value === "client" || value === "either") return value;
    return "all";
}

/** Parses directory filters separately from optional, non-persisted content locale overrides. */
export function parseCheatsQuery(input: QueryInput): CheatsQuery {
    const cheat = first(input.cheat)?.trim() || null;

    return {
        q: first(input.q)?.trim() ?? "",
        tab: first(input.tab)?.trim() || FEATURED_TAB,
        type: parseKind(first(input.type)),
        side: parseSide(first(input.side)),
        cheat,
        lang: parseCheatsLocale(first(input.lang)),
    };
}

/** Builds canonical share paths without changing command syntax or filter identifiers. */
export function buildCheatsPath(query: CheatsQuery) {
    const params = new URLSearchParams();
    const search = query.q.trim();

    if (search) params.set("q", search);
    if (query.tab && query.tab !== FEATURED_TAB) params.set("tab", query.tab);
    if (query.type !== "all") params.set("type", query.type);
    if (query.side !== "all") params.set("side", query.side);
    if (query.cheat) params.set("cheat", query.cheat);
    if (query.lang && query.lang !== "en") params.set("lang", query.lang);

    const qs = params.toString();
    return qs ? `/cheats?${qs}` : "/cheats";
}

/** Shares an immutable command identifier in the directory's current content locale. */
export function cheatSharePath(command: string, lang?: Locale) {
    return buildCheatsPath({
        q: "",
        tab: FEATURED_TAB,
        type: "all",
        side: "all",
        cheat: command,
        lang,
    });
}

