"use client";

import {
    FEATURED_TAB,
    featuredCommandNames,
    isFeaturedCommand,
} from "@/app/cheats/featured";
import {
    cheatsLabelClass,
    type CheatsLocale,
    type CheatsMessages,
} from "@/app/cheats/locale";
import {
    localizedCategory,
    localizedCommandSummary,
} from "@/app/cheats/locales";
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
    summary: string;
    usage: string;
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

function kindMatches(command: CheatCommand, kind: KindFilter) {
    if (kind === "all") return true;
    if (kind === "gameplay") return command.kind === "action" || command.kind === "audit";
    return command.kind === kind;
}

function textMatches(command: CheatCommand, query: string, messages: CheatsMessages) {
    if (!query) return true;

    const overlay = messages.commands[command.command];
    return [
        command.command,
        command.summary,
        command.usage,
        command.category,
        command.name,
        overlay?.name,
        overlay?.summary,
        messages.categories[command.category],
        messages.featured[command.command],
        ...(command.aliases ?? []),
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
}

function currentCheatsQuery(state: {
    search: string;
    kind: KindFilter;
    side: SideFilter;
    category: string;
    selectedCheat: string | null;
    lang: CheatsLocale;
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

function parseFromLocation() {
    return parseCheatsQuery(Object.fromEntries(new URLSearchParams(window.location.search)));
}

function writeCheatsUrl(query: CheatsQuery, mode: "replace" | "push") {
    const path = buildCheatsPath(query);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === path) return;

    if (mode === "push") {
        window.history.pushState(query, "", path);
        return;
    }

    window.history.replaceState(query, "", path);
}

function shareUrl(path: string) {
    return new URL(path, window.location.origin).toString();
}

export function CheatsDirectory({
    commands,
    initialQuery,
    locale,
    messages,
}: {
    commands: readonly CheatCommand[];
    initialQuery: CheatsQuery;
    locale: CheatsLocale;
    messages: CheatsMessages;
}) {
    const { ui } = messages;
    const kindFilters: { id: KindFilter; label: string }[] = [
        { id: "all", label: ui.kindAll },
        { id: "gameplay", label: ui.kindGameplay },
        { id: "inspect", label: ui.kindInspect },
    ];
    const sideFilters: { id: SideFilter; label: string }[] = [
        { id: "all", label: ui.sideAll },
        { id: "server", label: ui.sideServer },
        { id: "client", label: ui.sideClient },
        { id: "either", label: ui.sideEither },
    ];
    const sideLabels = {
        server: ui.sideServer,
        client: ui.sideClient,
        either: ui.sideEither,
    } as const;
    const kindLabels = {
        action: ui.kindAction,
        audit: ui.kindAudit,
        inspect: ui.kindInspectBadge,
        fixture: ui.kindFixture,
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
            && textMatches(command, query, messages)
        ));
    }, [commands, kind, messages, query, side]);

    const scopedFeaturedCommands = useMemo(() => {
        return featuredCommands.filter((command) => (
            kindMatches(command, kind)
            && (side === "all" || command.side === side)
            && textMatches(command, query, messages)
        ));
    }, [featuredCommands, kind, messages, query, side]);

    const categories = useMemo(() => {
        const counts = new Map<string, number>();
        for (const command of scopedCommands) {
            counts.set(command.category, (counts.get(command.category) ?? 0) + 1);
        }
        if (category !== "all" && category !== FEATURED_TAB && !counts.has(category)) {
            counts.set(category, 0);
        }

        return [...counts.entries()].sort((left, right) => {
            if (left[0] === "Player") return -1;
            if (right[0] === "Player") return 1;
            return localizedCategory(left[0], messages).localeCompare(
                localizedCategory(right[0], messages),
                locale === "zh-CN" ? "zh-CN" : "en",
            );
        });
    }, [category, locale, messages, scopedCommands]);

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

        const queryHidesCheat = search.trim() !== "" && !textMatches(match, search.trim().toLowerCase(), messages);
        const featuredHidesCheat = category === FEATURED_TAB && !isFeaturedCommand(selectedCheat);
        const categoryHidesCheat = category !== FEATURED_TAB && category !== "all" && match.category !== category;

        if (queryHidesCheat) setSearch("");
        if (featuredHidesCheat || categoryHidesCheat) {
            setCategory(isFeaturedCommand(selectedCheat) ? FEATURED_TAB : "all");
        }
    }, [category, commands, messages, search, selectedCheat]);

    useEffect(() => {
        const nextQuery = currentCheatsQuery({
            search,
            kind,
            side,
            category,
            selectedCheat,
            lang: locale,
        });
        writeCheatsUrl(nextQuery, "replace");
    }, [category, kind, locale, search, selectedCheat, side]);

    useEffect(() => {
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

    async function copyText(value: string, key = value) {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        window.setTimeout(() => {
            setCopied((current) => (current === key ? null : current));
        }, 1200);
    }

    function copySharePath(path: string) {
        return copyText(shareUrl(path), `link:${path}`);
    }

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

    function selectCategory(nextCategory: string) {
        setCategory(nextCategory);
        setSelectedCheat(null);
    }

    function selectKind(nextKind: KindFilter) {
        setKind(nextKind);
        setSelectedCheat(null);
    }

    function selectSide(nextSide: SideFilter) {
        setSide(nextSide);
        setSelectedCheat(null);
    }

    function updateSearch(nextSearch: string) {
        setSearch(nextSearch);
        setSelectedCheat(null);
    }

    return (
        <div className="grid min-w-0 grid-cols-1 gap-5 overflow-x-clip min-[800px]:grid-cols-[13rem_minmax(0,1fr)] min-[800px]:items-start min-[800px]:gap-6">
            <aside className="min-w-0 border border-white/10 bg-surface min-[800px]:sticky min-[800px]:top-20">
                <div className="border-b border-white/10 px-4 py-3">
                    <p className={`${cheatsLabelClass(locale, "eyebrow")} text-[0.65rem]`}>
                        {ui.categories}
                    </p>
                </div>
                <nav aria-label={ui.categoriesNav}>
                    <CategoryButton
                        locale={locale}
                        label={ui.featured}
                        count={scopedFeaturedCommands.length}
                        isActive={category === FEATURED_TAB}
                        onClick={() => selectCategory(FEATURED_TAB)}
                        icon={Star}
                    />
                    <CategoryButton
                        locale={locale}
                        label={ui.allCheats}
                        count={scopedCommands.length}
                        isActive={category === "all"}
                        onClick={() => selectCategory("all")}
                    />
                    {categories.map(([name, count]) => (
                        <CategoryButton
                            key={name}
                            locale={locale}
                            label={localizedCategory(name, messages)}
                            count={count}
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
                                {ui.searchLabel}
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
                                placeholder={ui.searchPlaceholder}
                                className="min-h-11 w-full border border-white/10 bg-background py-2 pl-10 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-dim focus:border-gold/50 focus:ring-1 focus:ring-gold/40"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => updateSearch("")}
                                    aria-label={ui.clearSearch}
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
                                    className={`inline-flex min-h-8 items-center gap-1.5 border border-white/10 bg-background px-2.5 text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${cheatsLabelClass(locale, "filter")}`}
                                >
                                    {copied === `link:${searchSharePath}` ? (
                                        <Check aria-hidden="true" className="size-3.5" />
                                    ) : (
                                        <Link2 aria-hidden="true" className="size-3.5" />
                                    )}
                                    {copied === `link:${searchSharePath}` ? ui.copiedLink : ui.copySearchLink}
                                </button>
                            )}
                            <p className="whitespace-nowrap font-label text-xs font-semibold tabular-nums text-foreground-dim" aria-live="polite">
                                {ui.shown(filteredCommands.length)}
                            </p>
                        </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <FilterGroup
                            locale={locale}
                            label={ui.type}
                            value={kind}
                            options={kindFilters}
                            onChange={selectKind}
                        />
                        <FilterGroup
                            locale={locale}
                            label={ui.side}
                            value={side}
                            options={sideFilters}
                            onChange={selectSide}
                        />
                    </div>
                </div>

                {isFeaturedTab && (
                    <div className="mb-4 border-l-2 border-gold bg-gold/[0.07] px-4 py-3.5 text-sm leading-6 text-foreground-muted">
                        <p className={`${cheatsLabelClass(locale, "eyebrow")} text-[0.65rem]`}>
                            {ui.findingIdsTitle}
                        </p>
                        {ui.findingIdsParagraphs.map((parts, index) => (
                            <p key={index} className="mt-2">
                                {parts.map((part, partIndex) => (
                                    "code" in part ? (
                                        <code key={partIndex} className="text-foreground">{part.code}</code>
                                    ) : (
                                        <span key={partIndex}>{part.text}</span>
                                    )
                                ))}
                            </p>
                        ))}
                    </div>
                )}

                {filteredCommands.length === 0 ? (
                    <div className="flex min-h-36 items-center justify-center border border-dashed border-white/15 bg-surface px-6 text-center text-sm text-foreground-muted">
                        {ui.empty}
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
                                    className={`group w-full scroll-mt-24 border-b border-white/10 last:border-b-0 ${isSelected ? "bg-gold/[0.08]" : "hover:bg-white/[0.025]"}`}
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
                                                {localizedCommandSummary(command, messages, isFeaturedTab)}
                                            </p>
                                            <p className="mt-2 max-w-full wrap-anywhere font-mono text-xs text-foreground-dim">
                                                {command.usage}
                                            </p>
                                        </div>
                                        <div className="flex w-full flex-wrap items-center gap-2">
                                            {showCategoryBadge && (
                                                <span className={`inline-flex max-w-full wrap-anywhere border border-white/10 bg-background/40 px-2 py-1 text-foreground-muted ${cheatsLabelClass(locale, "badge")}`}>
                                                    {localizedCategory(command.category, messages)}
                                                </span>
                                            )}
                                            <span className={`inline-flex border px-2 py-1 ${cheatsLabelClass(locale, "badge")} ${sideStyles[command.side]}`}>
                                                {sideLabels[command.side]}
                                            </span>
                                            <span className={`inline-flex text-foreground-dim ${cheatsLabelClass(locale, "badge")}`}>
                                                {kindLabels[command.kind]}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => copySharePath(commandPath)}
                                                className={`inline-flex min-h-9 items-center justify-center gap-1.5 border border-white/10 bg-background px-2.5 text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${cheatsLabelClass(locale, "button")}`}
                                            >
                                                {copied === `link:${commandPath}` ? (
                                                    <Check aria-hidden="true" className="size-3.5" />
                                                ) : (
                                                    <Link2 aria-hidden="true" className="size-3.5" />
                                                )}
                                                {copied === `link:${commandPath}` ? ui.copiedLink : ui.copyLink}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => copyText(command.usage, `usage:${command.usage}`)}
                                                className={`inline-flex min-h-9 items-center justify-center gap-1.5 border border-gold/35 bg-gold/[0.07] px-2.5 text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${cheatsLabelClass(locale, "button")}`}
                                            >
                                                {copied === `usage:${command.usage}` ? (
                                                    <Check aria-hidden="true" className="size-3.5" />
                                                ) : (
                                                    <Copy aria-hidden="true" className="size-3.5" />
                                                )}
                                                {copied === `usage:${command.usage}` ? ui.copied : ui.copy}
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

function CategoryButton({
    locale,
    label,
    count,
    isActive,
    onClick,
    icon: Icon,
}: {
    locale: CheatsLocale;
    label: string;
    count: number;
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
                    ? "flex w-full min-w-0 items-center justify-between gap-3 border-l-2 border-gold bg-gold/[0.08] px-4 py-2.5 text-left"
                    : "flex w-full min-w-0 items-center justify-between gap-3 border-l-2 border-transparent px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03] hover:text-gold"
            }
        >
            <span className={`flex min-w-0 items-center gap-2 wrap-break-word ${cheatsLabelClass(locale, "nav")} ${isActive ? "text-gold" : "text-foreground-muted"}`}>
                {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                {label}
            </span>
            <span className={`shrink-0 font-label text-[0.65rem] font-semibold tabular-nums ${isActive ? "text-gold" : "text-foreground-dim"}`}>
                {count}
            </span>
        </button>
    );
}

function FilterGroup<T extends string>({
    locale,
    label,
    value,
    options,
    onChange,
}: {
    locale: CheatsLocale;
    label: string;
    value: T;
    options: readonly { id: T; label: string }[];
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <p className={`text-foreground-dim ${cheatsLabelClass(locale, "filter")}`}>
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
                                ? `inline-flex min-h-8 items-center border border-gold/60 bg-gold/15 px-3 text-gold ${cheatsLabelClass(locale, "filter")}`
                                : `inline-flex min-h-8 items-center border border-white/10 bg-background px-3 text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold ${cheatsLabelClass(locale, "filter")}`
                        }
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
