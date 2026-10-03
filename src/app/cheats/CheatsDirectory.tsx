"use client";

import {
    FEATURED_TAB,
    featuredCommandNames,
    isFeaturedCommand,
} from "@/app/cheats/featured";
import { cheatsLabelClass } from "@/app/cheats/locale";
import { useTranslations } from "@/app/lib/localization/client";
import type { Translator } from "@/app/lib/localization/types";
import {
    buildCheatsPath,
    cheatSharePath,
    parseCheatsQuery,
    type CheatsQuery,
    type CheatKindFilter,
    type CheatSideFilter,
} from "@/app/cheats/query";
import { Check, Copy, Link2, Search, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type CheatCommand = {
    command: string;
    name: string;
    group: string;
    category: string;
    sourceSearch?: string;
    usage: string;
    arguments: { name: string; required: boolean }[];
    side: "server" | "client" | "either";
    kind: "action" | "inspect" | "fixture" | "audit";
    aliases?: string[];
};

type KindFilter = CheatKindFilter;
type SideFilter = CheatSideFilter;

const sideStyles = {
    server: "border-crimson/30 bg-crimson/10 text-crimson-hover",
    client: "border-gold/35 bg-gold/[0.07] text-gold",
    either: "border-white/10 bg-background/40 text-foreground-muted",
} as const;

/** Applies existing command-kind filters without changing operational categories. */
function kindMatches(command: CheatCommand, kind: KindFilter) {
    if (kind === "all") return true;
    if (kind === "gameplay") return command.kind === "action" || command.kind === "audit";
    return command.kind === kind;
}

/** Searches immutable syntax plus current-locale and original English explanatory text. */
function textMatches(command: CheatCommand, query: string, { t }: Translator) {
    if (!query) return true;
    return [
        command.command,
        command.usage,
        command.category,
        command.name,
        command.sourceSearch,
        t(`command.${command.command}.summary`),
        t(categoryKey(command.category)),
        ...command.arguments.flatMap((argument) => [argument.name, t(`command.${command.command}.argument.${argument.name}`)]),
        ...(command.aliases ?? []),
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
}

/** Derives stable message keys from unchanged category URL identifiers. */
function categoryKey(category: string) {
    return `category.${category.toLowerCase().replaceAll(" ", "_")}`;
}

/** Captures filter state while keeping explicit language overrides separate from the cookie locale. */
function currentCheatsQuery(state: {
    search: string;
    kind: KindFilter;
    side: SideFilter;
    category: string;
    selectedCheat: string | null;
    lang?: CheatsQuery["lang"];
}): CheatsQuery {
    return {
        q: state.search.trim(),
        tab: state.category,
        type: state.kind,
        side: state.side,
        cheat: state.selectedCheat,
        lang: state.lang,
    };
}

/** Reads current filters for browser back/forward navigation. */
function parseFromLocation() {
    return parseCheatsQuery(Object.fromEntries(new URLSearchParams(window.location.search)));
}

/** Updates only directory filters, retaining the explicit locale, unrelated parameters, and anchor. */
function writeCheatsUrl(query: CheatsQuery, mode: "replace" | "push") {
    const url = new URL(window.location.href);
    const filters = new URL(buildCheatsPath(query), url.origin);
    for (const key of ["q", "tab", "type", "side", "cheat"]) {
        url.searchParams.delete(key);
        const value = filters.searchParams.get(key);
        if (value) url.searchParams.set(key, value);
    }
    const path = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current === path) return;

    if (mode === "push") {
        window.history.pushState(query, "", path);
        return;
    }

    window.history.replaceState(query, "", path);
}

/** Converts a share path into a copyable absolute link on the current origin. */
function shareUrl(path: string) {
    return new URL(path, window.location.origin).toString();
}

/** Presents and filters translated command help while preserving executable command syntax. */
export function CheatsDirectory({
    commands,
    initialQuery,
}: {
    commands: readonly CheatCommand[];
    initialQuery: CheatsQuery;
}) {
    const translator = useTranslations("cheats");
    const { t, rich, number, locale } = translator;
    const kindFilters: { id: KindFilter; label: string }[] = [
        { id: "all", label: t("ui.kindAll") },
        { id: "gameplay", label: t("ui.kindGameplay") },
        { id: "inspect", label: t("ui.kindInspect") },
    ];
    const sideFilters: { id: SideFilter; label: string }[] = [
        { id: "all", label: t("ui.sideAll") },
        { id: "server", label: t("ui.sideServer") },
        { id: "client", label: t("ui.sideClient") },
        { id: "either", label: t("ui.sideEither") },
    ];
    const sideLabels = {
        server: t("ui.sideServer"),
        client: t("ui.sideClient"),
        either: t("ui.sideEither"),
    } as const;
    const kindLabels = {
        action: t("ui.kindAction"),
        audit: t("ui.kindAudit"),
        inspect: t("ui.kindInspectBadge"),
        fixture: t("ui.kindFixture"),
    } as const;
    const [search, setSearch] = useState(initialQuery.q);
    const [kind, setKind] = useState<KindFilter>(initialQuery.type);
    const [side, setSide] = useState<SideFilter>(initialQuery.side);
    const [category, setCategory] = useState(initialQuery.tab);
    const [selectedCheat, setSelectedCheat] = useState<string | null>(initialQuery.cheat);
    const [copied, setCopied] = useState<string | null>(null);

    const query = search.trim().toLowerCase();

    const featuredCommands = useMemo(() => {
        const byName = new Map(commands.map((command) => [command.command, command]));
        return featuredCommandNames.flatMap((name) => {
            const command = byName.get(name);
            return command ? [command] : [];
        });
    }, [commands]);

    const scopedCommands = useMemo(() => {
        return commands.filter((command) => (
            kindMatches(command, kind)
            && (side === "all" || command.side === side)
            && textMatches(command, query, translator)
        ));
    }, [commands, kind, translator, query, side]);

    const scopedFeaturedCommands = useMemo(() => {
        return featuredCommands.filter((command) => (
            kindMatches(command, kind)
            && (side === "all" || command.side === side)
            && textMatches(command, query, translator)
        ));
    }, [featuredCommands, kind, translator, query, side]);

    const categories = useMemo(() => {
        const counts = new Map<string, number>();
        for (const command of scopedCommands) {
            counts.set(command.category, (counts.get(command.category) ?? 0) + 1);
        }
        if (category !== "all" && category !== FEATURED_TAB && !counts.has(category)) {
            counts.set(category, 0);
        }

        const knownCategories = new Set(commands.map((command) => command.category));
        // Unknown category queries are user content, not missing translation keys.
        const entries = [...counts.entries()].map(([id, count]) => ({
            id, count, label: knownCategories.has(id) ? t(categoryKey(id)) : id,
        }));
        return entries.sort((left, right) => {
            if (left.id === "Player") return -1;
            if (right.id === "Player") return 1;
            return left.label.localeCompare(right.label, locale);
        });
    }, [category, commands, locale, t, scopedCommands]);

    const filteredCommands = useMemo(() => {
        if (category === FEATURED_TAB) return scopedFeaturedCommands;
        if (category === "all") return scopedCommands;
        return scopedCommands.filter((command) => command.category === category);
    }, [category, scopedCommands, scopedFeaturedCommands]);

    const showCategoryBadge = category === FEATURED_TAB || category === "all";
    const isFeaturedTab = category === FEATURED_TAB;
    const activeQuery = currentCheatsQuery({
        search,
        kind,
        side,
        category,
        selectedCheat,
        lang: locale,
    });
    const searchSharePath = buildCheatsPath({ ...activeQuery, cheat: null });
    const canShareSearch = Boolean(activeQuery.q || activeQuery.tab !== FEATURED_TAB || activeQuery.type !== "all" || activeQuery.side !== "all");

    useEffect(() => {
        if (!selectedCheat) return;

        const match = commands.find((command) => command.command === selectedCheat);
        if (!match) return;

        const queryHidesCheat = search.trim() !== "" && !textMatches(match, search.trim().toLowerCase(), translator);
        const featuredHidesCheat = category === FEATURED_TAB && !isFeaturedCommand(selectedCheat);
        const categoryHidesCheat = category !== FEATURED_TAB && category !== "all" && match.category !== category;

        if (queryHidesCheat) setSearch("");
        if (featuredHidesCheat || categoryHidesCheat) {
            setCategory(isFeaturedCommand(selectedCheat) ? FEATURED_TAB : "all");
        }
    }, [category, commands, translator, search, selectedCheat]);

    useEffect(() => {
        const nextQuery = currentCheatsQuery({
            search,
            kind,
            side,
            category,
            selectedCheat,
        });
        writeCheatsUrl(nextQuery, "replace");
    }, [category, kind, search, selectedCheat, side]);

    useEffect(() => {
        /** Restores directory filters from browser history. */
        function onPopState() {
            const next = parseFromLocation();
            setSearch(next.q);
            setKind(next.type);
            setSide(next.side);
            setCategory(next.tab);
            setSelectedCheat(next.cheat);
        }

        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, []);

    useEffect(() => {
        if (!selectedCheat) return;

        const node = document.getElementById(`cheat-${selectedCheat}`);
        if (!node) return;

        node.scrollIntoView({ block: "center", behavior: "smooth" });
    }, [filteredCommands, selectedCheat]);

    /** Copies executable syntax or share links unchanged and briefly confirms success. */
    async function copyText(value: string, key = value) {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        window.setTimeout(() => {
            setCopied((current) => (current === key ? null : current));
        }, 1200);
    }

    /** Copies the complete current-origin share URL. */
    function copySharePath(path: string) {
        return copyText(shareUrl(path), `link:${path}`);
    }

    /** Opens a command and records its existing deep-link state in browser history. */
    function selectCheat(command: string) {
        setSelectedCheat(command);
        setSearch("");
        setKind("all");
        setSide("all");
        setCategory(isFeaturedCommand(command) ? FEATURED_TAB : "all");
        writeCheatsUrl({
            q: "",
            tab: isFeaturedCommand(command) ? FEATURED_TAB : "all",
            type: "all",
            side: "all",
            cheat: command,
            lang: locale,
        }, "push");
    }

    /** Selects a category while clearing the command target. */
    function selectCategory(nextCategory: string) {
        setCategory(nextCategory);
        setSelectedCheat(null);
    }

    /** Selects a command-kind filter while clearing the command target. */
    function selectKind(nextKind: KindFilter) {
        setKind(nextKind);
        setSelectedCheat(null);
    }

    /** Selects an execution-side filter while clearing the command target. */
    function selectSide(nextSide: SideFilter) {
        setSide(nextSide);
        setSelectedCheat(null);
    }

    /** Updates free-text search while clearing the command target. */
    function updateSearch(nextSearch: string) {
        setSearch(nextSearch);
        setSelectedCheat(null);
    }

    return (
        <div className="grid min-w-0 grid-cols-1 gap-5 overflow-x-clip min-[800px]:grid-cols-[13rem_minmax(0,1fr)] min-[800px]:items-start min-[800px]:gap-6">
            <aside className="min-w-0 border border-white/10 bg-surface min-[800px]:sticky min-[800px]:top-20">
                <div className="border-b border-white/10 px-4 py-3">
                    <p className={`${cheatsLabelClass("eyebrow")} text-[0.65rem]`}>
                        {t("ui.categories")}
                    </p>
                </div>
                <nav aria-label={t("ui.categoriesNav")}>
                    <CategoryButton
                        label={t("ui.featured")}
                        count={number(scopedFeaturedCommands.length)}
                        isActive={category === FEATURED_TAB}
                        onClick={() => selectCategory(FEATURED_TAB)}
                        icon={Star}
                    />
                    <CategoryButton
                        label={t("ui.allCheats")}
                        count={number(scopedCommands.length)}
                        isActive={category === "all"}
                        onClick={() => selectCategory("all")}
                    />
                    {categories.map(({ id: name, count, label }) => (
                        <CategoryButton
                            key={name}
                            label={label}
                            count={number(count)}
                            isActive={category === name}
                            onClick={() => selectCategory(name)}
                        />
                    ))}
                </nav>
            </aside>

            <div className="min-w-0 overflow-x-clip">
                <div className="mb-4 border border-white/10 bg-surface p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="relative w-full sm:max-w-md">
                            <label htmlFor="cheat-search" className="sr-only">
                                {t("ui.searchLabel")}
                            </label>
                            <Search
                                aria-hidden="true"
                                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-foreground-dim"
                            />
                            <input
                                id="cheat-search"
                                type="search"
                                value={search}
                                onChange={(event) => updateSearch(event.target.value)}
                                placeholder={t("ui.searchPlaceholder")}
                                className="min-h-11 w-full border border-white/10 bg-background py-2 pl-10 pr-10 text-sm text-foreground outline-none transition-colors focus:ring-1 focus:ring-gold/40"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => updateSearch("")}
                                    aria-label={t("ui.clearSearch")}
                                    className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center text-foreground-dim transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                                >
                                    <X aria-hidden="true" className="size-4" />
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
                            {canShareSearch && (
                                <button
                                    type="button"
                                    onClick={() => copySharePath(searchSharePath)}
                                    className={`inline-flex min-h-8 items-center gap-1.5 border border-white/10 bg-background px-2.5 text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${cheatsLabelClass("filter")}`}
                                >
                                    {copied === `link:${searchSharePath}` ? (
                                        <Check aria-hidden="true" className="size-3.5" />
                                    ) : (
                                        <Link2 aria-hidden="true" className="size-3.5" />
                                    )}
                                    {copied === `link:${searchSharePath}` ? t("ui.copiedLink") : t("ui.copySearchLink")}
                                </button>
                            )}
                            <p className="whitespace-nowrap font-label text-xs font-semibold tabular-nums text-foreground-dim" aria-live="polite">
                                {t("ui.shown", { count: filteredCommands.length, formattedCount: number(filteredCommands.length) })}
                            </p>
                        </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <FilterGroup
                            label={t("ui.type")}
                            value={kind}
                            options={kindFilters}
                            onChange={selectKind}
                        />
                        <FilterGroup
                            label={t("ui.side")}
                            value={side}
                            options={sideFilters}
                            onChange={selectSide}
                        />
                    </div>
                </div>

                {isFeaturedTab && (
                    <div className="mb-4 border-l-2 border-gold bg-gold/[0.07] px-4 py-3.5 text-sm leading-6 text-foreground-muted">
                        <p className={`${cheatsLabelClass("eyebrow")} text-[0.65rem]`}>
                            {t("ui.findingIdsTitle")}
                        </p>
                        {[
                            rich("ui.findingIds.client", {
                                playersList: <code className="text-foreground">coop.debug.players.list</code>,
                                controllerId: <code className="text-foreground">Controller_Player</code>,
                                playerId: <code className="text-foreground">Player</code>,
                            }),
                            rich("ui.findingIds.server", {
                                siegeBuff: <code className="text-foreground">coop.debug.mobile_party.siege_buff Player</code>,
                                whoAmI: <code className="text-foreground">coop.debug.mobile_party.who_am_i</code>,
                                heroList: <code className="text-foreground">coop.debug.hero.list</code>,
                            }),
                            rich("ui.findingIds.romance", {
                                coopData: <code className="text-foreground">{"Documents\\Mount and Blade II Bannerlord\\CoopData"}</code>,
                                cheatMode: <code className="text-foreground">config.cheat_mode 1</code>,
                            }),
                        ].map((paragraph, index) => <p key={index} className="mt-2">{paragraph}</p>)}
                    </div>
                )}

                {filteredCommands.length === 0 ? (
                    <div className="flex min-h-36 items-center justify-center border border-dashed border-white/15 bg-surface px-6 text-center text-sm text-foreground-muted">
                        {t("ui.empty")}
                    </div>
                ) : (
                    <div className="overflow-x-clip border border-white/10 bg-surface">
                        <ul className="w-full">
                            {filteredCommands.map((command) => {
                                const isSelected = selectedCheat === command.command;
                                const commandPath = cheatSharePath(command.command, locale);

                                return (
                                <li
                                    key={command.command}
                                    id={`cheat-${command.command}`}
                                    className={`group w-full scroll-mt-24 border-b border-white/10 ${isSelected ? "bg-gold/8" : "hover:bg-white/2.5"}`}
                                >
                                    <div className={`grid w-full gap-3 px-4 py-4 sm:px-5 sm:py-5 ${isSelected ? "border-l-2 border-gold" : "border-l-2 border-transparent"}`}>
                                        <div className="min-w-0">
                                            <a
                                                href={commandPath}
                                                onClick={(event) => {
                                                    event.preventDefault();
                                                    selectCheat(command.command);
                                                }}
                                                className="max-w-full wrap-anywhere font-label text-sm font-semibold tracking-[0.04em] text-foreground transition-colors hover:text-gold group-hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                                            >
                                                {command.command}
                                            </a>
                                            <p className="mt-1 max-w-full text-sm leading-6 wrap-anywhere text-foreground-muted">
                                                {t(`command.${command.command}.summary`)}
                                            </p>
                                            <p className="mt-2 max-w-full wrap-anywhere font-mono text-xs text-foreground-dim">
                                                {command.usage}
                                            </p>
                                            {command.arguments.length > 0 && (
                                                <details className="mt-3 text-sm text-foreground-muted">
                                                    <summary className="cursor-pointer text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                                                        {t("ui.parameters")}
                                                    </summary>
                                                    <p className="mt-2 text-xs leading-5">{t("ui.parameterTip")}</p>
                                                    <dl className="mt-2 space-y-2">
                                                        {command.arguments.map((argument) => (
                                                            <div key={argument.name}>
                                                                <dt className="wrap-anywhere">
                                                                    <code>{argument.name}</code>
                                                                    <span className="ml-2 text-xs text-foreground-dim">
                                                                        {argument.required ? t("ui.required") : t("ui.optional")}
                                                                    </span>
                                                                </dt>
                                                                <dd className="mt-0.5 wrap-anywhere text-xs leading-5">
                                                                    {t(`command.${command.command}.argument.${argument.name}`)}
                                                                </dd>
                                                            </div>
                                                        ))}
                                                    </dl>
                                                </details>
                                            )}
                                        </div>
                                        <div className="flex w-full flex-wrap items-center gap-2">
                                            {showCategoryBadge && (
                                                <span className={`inline-flex max-w-full wrap-anywhere border border-white/10 bg-background/40 px-2 py-1 text-foreground-muted ${cheatsLabelClass("badge")}`}>
                                                    {t(categoryKey(command.category))}
                                                </span>
                                            )}
                                            <span className={`inline-flex border px-2 py-1 ${cheatsLabelClass("badge")} ${sideStyles[command.side]}`}>
                                                {sideLabels[command.side]}
                                            </span>
                                            <span className={`inline-flex text-foreground-dim ${cheatsLabelClass("badge")}`}>
                                                {kindLabels[command.kind]}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => copySharePath(commandPath)}
                                                className={`inline-flex min-h-9 items-center justify-center gap-1.5 borde border-white/10 bg-background px-2.5 text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${cheatsLabelClass("button")}`}
                                            >
                                                {copied === `link:${commandPath}` ? (
                                                    <Check aria-hidden="true" className="size-3.5" />
                                                ) : (
                                                    <Link2 aria-hidden="true" className="size-3.5" />
                                                )}
                                                {copied === `link:${commandPath}` ? t("ui.copiedLink") : t("ui.copyLink")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => copyText(command.usage, `usage:${command.usage}`)}
                                                className={`inline-flex min-h-9 items-center justify-center gap-1.5 border border-gold/35 bg-gold/[0.07] px-2.5 text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${cheatsLabelClass("button")}`}
                                            >
                                                {copied === `usage:${command.usage}` ? (
                                                    <Check aria-hidden="true" className="size-3.5" />
                                                ) : (
                                                    <Copy aria-hidden="true" className="size-3.5" />
                                                )}
                                                {copied === `usage:${command.usage}` ? t("ui.copied") : t("ui.copy")}
                                            </button>
                                        </div>
                                    </div>
                                </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

/** Renders a category filter with its locale-formatted result count. */
function CategoryButton({
    label,
    count,
    isActive,
    onClick,
    icon: Icon,
}: {
    label: string;
    count: string;
    isActive: boolean;
    onClick: () => void;
    icon?: typeof Star;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                isActive
                    ? "flex w-full min-w-0 items-center justify-between gap-3 border-l-2 border-gold bg-gold/8 px-4 py-2.5 text-left"
                    : "flex w-full min-w-0 items-center justify-between gap-3 border-l-2 border-transparent px-4 py-2.5 text-left transition-colors hover:bg-white/3 hover:text-gold"
            }
        >
            <span className={`flex min-w-0 items-center gap-2 wrap-break-word ${cheatsLabelClass("nav")} ${isActive ? "text-gold" : "text-foreground-muted"}`}>
                {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                {label}
            </span>
            <span className={`shrink-0 font-label text-[0.65rem] font-semibold tabular-nums ${isActive ? "text-gold" : "text-foreground-dim"}`}>
                {count}
            </span>
        </button>
    );
}

/** Renders translated labels for unchanged filter values. */
function FilterGroup<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: readonly { id: T; label: string }[];
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <p className={`text-foreground-dim ${cheatsLabelClass("filter")}`}>
                {label}
            </p>
            {options.map((option) => {
                const isActive = option.id === value;
                return (
                    <button
                        key={option.id}
                        type="button"
                        onClick={() => onChange(option.id)}
                        className={
                            isActive
                                ? `inline-flex min-h-8 items-center border border-gold/60 bg-gold/15 px-3 text-gold ${cheatsLabelClass("filter")}`
                                : `inline-flex min-h-8 items-center border border-white/10 bg-background px-3 text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold ${cheatsLabelClass("filter")}`
                        }
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
