import { FEATURED_TAB } from "@/app/cheats/featured";

export type CheatKindFilter = "all" | "gameplay" | "inspect";
export type CheatSideFilter = "all" | "server" | "client" | "either";

export type CheatsQuery = {
    q: string;
    tab: string;
    type: CheatKindFilter;
    side: CheatSideFilter;
    cheat: string | null;
};

type QueryInput = {
    q?: string | string[];
    tab?: string | string[];
    type?: string | string[];
    side?: string | string[];
    cheat?: string | string[];
};

function first(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function parseKind(value: string | undefined): CheatKindFilter {
    if (value === "gameplay" || value === "inspect") return value;
    return "all";
}

function parseSide(value: string | undefined): CheatSideFilter {
    if (value === "server" || value === "client" || value === "either") return value;
    return "all";
}

export function parseCheatsQuery(input: QueryInput): CheatsQuery {
    const cheat = first(input.cheat)?.trim() || null;

    return {
        q: first(input.q)?.trim() ?? "",
        tab: first(input.tab)?.trim() || FEATURED_TAB,
        type: parseKind(first(input.type)),
        side: parseSide(first(input.side)),
        cheat,
    };
}

export function buildCheatsPath(query: CheatsQuery) {
    const params = new URLSearchParams();
    const search = query.q.trim();

    if (search) params.set("q", search);
    if (query.tab && query.tab !== FEATURED_TAB) params.set("tab", query.tab);
    if (query.type !== "all") params.set("type", query.type);
    if (query.side !== "all") params.set("side", query.side);
    if (query.cheat) params.set("cheat", query.cheat);

    const qs = params.toString();
    return qs ? `/cheats?${qs}` : "/cheats";
}

export function cheatSharePath(command: string) {
    return buildCheatsPath({
        q: "",
        tab: FEATURED_TAB,
        type: "all",
        side: "all",
        cheat: command,
    });
}

