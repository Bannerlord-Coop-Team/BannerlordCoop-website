"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, Copy, Database, Eye, EyeOff, FileJson, Play, Puzzle, RotateCw, Search, Settings2, Square, Terminal } from "lucide-react";

import commandsData from "@/app/cheats/commands.json";
import { isPublishedCheat } from "@/app/cheats/debugOnly";
import { idLookupOutputs } from "@/app/cheats/idLookups";
import { translateCheat } from "@/app/cheats/translation";
import { segmentedButtonClass, segmentedGroupClass } from "./segmented-controls";
import { SERVER_WORKSPACE_TAB_PARAMETER, serverWorkspaceSectionFromTab, serverWorkspaceTab, type ServerWorkspaceSection } from "./server-workspace-tabs";

const sections = [
    { name: "Console", label: "section.console", icon: Terminal },
    { name: "Backups", label: "section.backups", icon: Database },
    { name: "Save & config", label: "section.saveConfig", icon: FileJson },
    { name: "Mods", label: "section.mods", icon: Puzzle },
    { name: "Settings", label: "section.settings", icon: Settings2 },
] as const;
type Section = ServerWorkspaceSection;
const COPY_FEEDBACK_MILLISECONDS = 2_000;
const WorkspaceContext = createContext<{ current: Section; initial: Section; revealAddress: () => void; address: string | null }>({ current: "Console", initial: "Console", revealAddress: () => {}, address: null });
const subscribe = () => () => {};
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-foreground hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";

// Keeps inactive panels mounted while following the current section identity.
export function ServerWorkspacePanel({ section, children }: { section: Section; children: ReactNode }) {
    const shown = useServerWorkspaceSectionShown(section);
    // Preserve console connections, pending operations and transfer drafts across tabs.
    return <div hidden={!shown} className="space-y-5">{children}</div>;
}

/** Whether a workspace section is the one currently shown, so a panel can defer loading until it is opened. */
export function useServerWorkspaceSectionShown(section: Section) {
    const { current, initial } = useContext(WorkspaceContext);
    // Streamed panels must first match their server HTML, even if the hash already changed tabs.
    return useSyncExternalStore(subscribe, () => current, () => initial) === section;
}

/** Reveals the join address when a live start has been confirmed. */
export function useRevealServerAddress() {
    return useContext(WorkspaceContext).revealAddress;
}

/** The join address the header currently has, whether shown or hidden; null without one or outside the workspace. */
export function useServerAddress() {
    return useContext(WorkspaceContext).address;
}

// Published command syntax is shared by completion without duplicating translated command prose.
export const coopConsoleCommands = commandsData.commands
    .filter(command => command.side !== "client" && isPublishedCheat(command))
    .map(command => [command.usage]).filter(([usage]) => usage.startsWith("coop."));

type ConsoleCommand = { usage: string; description: string; search?: string; kind: "inspect" | "gameplay"; category?: string; returns?: readonly string[] };
type ConsoleCommandFilter = "all" | "ids" | "inspect" | "gameplay";

/** Matches a type chip; ID lookups are commands whose output feeds other commands' id arguments. */
function matchesConsoleFilter(command: ConsoleCommand, filter: ConsoleCommandFilter) {
    return filter === "all" || (filter === "ids" ? !!command.returns : command.kind === filter);
}

/** Keeps the console primary and exposes its supported command reference only on request. */
export function ServerConsoleWorkspace({ children, onSelectCommand, coopCommandsOnly = false }: { children: ReactNode; onSelectCommand?: (command: string) => void; coopCommandsOnly?: boolean }) {
    const { t } = useTranslations("server-common");
    const cheats = useTranslations("cheats");
    const consoleCommands: { group: string; commands: ConsoleCommand[] }[] = [
        { group: t("managementWorkspace.information"), commands: [
            { usage: "help", description: t("managementWorkspace.listAvailableConsoleCommands"), kind: "inspect" },
            { usage: "status", description: t("managementWorkspace.showCampaignTimePartiesAndPlayers"), kind: "inspect" },
            { usage: "players", description: t("managementWorkspace.listConnectedPlayersAndTheirIds"), kind: "inspect", returns: ["id"] },
        ] },
        { group: t("managementWorkspace.campaign"), commands: [
            { usage: "save", description: t("managementWorkspace.saveTheCurrentCampaign"), kind: "gameplay" },
            { usage: "stop", description: t("managementWorkspace.saveTheWorldAndShutDownTheServer"), kind: "gameplay" },
        ] },
        { group: t("managementWorkspace.players"), commands: [
            { usage: "say <text>", description: t("managementWorkspace.broadcastAMessageToAllPlayers"), kind: "gameplay" },
            { usage: "kick <id|name>", description: t("managementWorkspace.disconnectAPlayerUsePlayersToFindTheirId"), kind: "gameplay" },
        ] },
        { group: t("managementWorkspace.gameCommandsCheats"), commands: commandsData.commands
            .filter(command => command.side !== "client" && isPublishedCheat(command))
            .map(command => {
                const category = translateCheat(cheats.t, `category.${command.category.toLowerCase().replaceAll(" ", "_")}`, command.category);
                return {
                    usage: command.usage,
                    description: translateCheat(cheats.t, `command.${command.command}.summary`, command.summary),
                    search: [command.name, category, ...command.aliases,
                        ...command.arguments.map(argument => translateCheat(cheats.t, `command.${command.command}.argument.${argument.name}`, argument.description)),
                    ].join(" "),
                    kind: command.kind === "inspect" ? "inspect" : "gameplay",
                    category,
                    returns: idLookupOutputs[command.command],
                };
            }) },
    ];
    const typeFilters: { id: ConsoleCommandFilter; label: string }[] = [
        { id: "all", label: cheats.t("ui.kindAll") },
        { id: "ids", label: t("managementWorkspace.idLookups") },
        { id: "inspect", label: cheats.t("ui.kindInspect") },
        { id: "gameplay", label: cheats.t("ui.kindGameplay") },
    ];
    const [query, setQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<ConsoleCommandFilter>("all");
    const [category, setCategory] = useState("");
    const [expanded, setExpanded] = useState(false);
    const id = useId();
    const available = !!onSelectCommand;
    const search = query.trim().toLowerCase();
    const offered = consoleCommands.map(({ group, commands }) => ({ group, commands: commands.filter(command => !coopCommandsOnly || command.usage.startsWith("coop.")) }));
    const categories = [...new Set(offered.flatMap(({ commands }) => commands.flatMap(command => command.category ? [command.category] : [])))].sort((a, b) => a.localeCompare(b));
    // Chip counts follow search and category, so each reports what selecting it would show.
    const searched = offered.map(({ group, commands }) => ({
        group, commands: commands.filter(command => (!category || command.category === category)
            && `${group} ${command.usage} ${command.description} ${command.search ?? ""}`.toLowerCase().includes(search)),
    }));
    const groups = searched.map(({ group, commands }) => ({ group, commands: commands.filter(command => matchesConsoleFilter(command, typeFilter)) })).filter(({ commands }) => commands.length > 0);
    return <div className="space-y-3">
        <div className="min-w-0 space-y-5">{children}</div>
        <aside className="min-w-0 rounded-lg border border-white/10 bg-surface" aria-label={t("managementWorkspace.consoleCommands")}>
            <button type="button" disabled={!available} aria-expanded={expanded && available} aria-controls={`${id}-commands`} onClick={() => setExpanded(!expanded)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-medium text-foreground-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40">{t("managementWorkspace.browseCommands")}<ChevronDown className={`size-4 transition-transform ${expanded && available ? "rotate-180" : ""}`} aria-hidden="true" /></button>
            <div id={`${id}-commands`} hidden={!expanded || !available} className="border-t border-white/10 p-4">
                <label htmlFor={`${id}-search`} className="sr-only">{t("managementWorkspace.searchConsoleCommands")}</label>
                <div className="relative"><Search className="absolute top-3 left-3 size-4 text-foreground-muted" aria-hidden="true" /><input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} disabled={!available} className="w-full rounded-md border border-white/15 bg-background py-2.5 pr-3 pl-9 text-sm focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40" placeholder={t("managementWorkspace.searchCommands")} /></div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div role="group" aria-label={cheats.t("ui.type")} className="flex flex-wrap gap-2">{typeFilters.map(option => <button key={option.id} type="button" aria-pressed={typeFilter === option.id} disabled={!available} onClick={() => setTypeFilter(option.id)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 ${typeFilter === option.id ? "border-gold/50 bg-gold/15 text-gold" : "border-white/15 text-foreground-muted hover:text-foreground"}`}>{option.label}<span className="tabular-nums opacity-70">{searched.reduce((total, { commands }) => total + commands.filter(command => matchesConsoleFilter(command, option.id)).length, 0)}</span></button>)}</div>
                    {categories.length > 0 && <><label htmlFor={`${id}-category`} className="sr-only">{cheats.t("ui.categories")}</label><select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value)} disabled={!available} className="min-h-8 rounded-full border border-white/15 bg-background px-3 text-xs text-foreground-muted focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40"><option value="">{cheats.t("ui.categories")}</option>{categories.map(name => <option key={name} value={name}>{name}</option>)}</select></>}
                </div>
                <div className="mt-4 max-h-96 space-y-4 overflow-y-auto overscroll-contain pr-1">
                    {groups.map(({ group, commands }) => <section key={group}>
                        <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-foreground-muted">{group}</h3>
                        <ul className="grid gap-x-6 divide-y divide-white/10 md:grid-cols-2">{commands.map(({ usage, description, returns }) => <li key={usage}><button type="button" disabled={!available} onClick={() => { onSelectCommand?.(usage); setExpanded(false); }} className="flex w-full items-center justify-between gap-3 rounded px-1 py-3 text-left hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40"><span className="min-w-0"><code className="block break-words text-sm text-foreground [overflow-wrap:anywhere]">{usage}</code><span className="mt-1 block text-[13px] leading-5 text-foreground-muted">{description}</span>{returns && <span className="mt-1.5 inline-block rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 font-mono text-[11px] leading-5 text-emerald-300"><span className="sr-only">{t("managementWorkspace.returnsIds")} </span><span aria-hidden="true">→ </span>{returns.join(" · ")}</span>}</span><ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" /></button></li>)}</ul>
                    </section>)}
                    {groups.length === 0 && <p role="status" className="text-sm text-foreground-muted">{t("managementWorkspace.noCommandsMatchYourSearch")}</p>}
                </div>
            </div>
        </aside>
    </div>;
}

// Renders disconnected console controls without enabling unsupported actions.
export function UnavailableServerConsole({ controls }: { controls?: ReactNode }) {
    const { t } = useTranslations("server-common");
    return <section className="min-w-0 rounded-lg border border-white/10 bg-surface">
        {/* Mirrors the live console header: title with the lifecycle controls on the right. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-white/10 p-3 sm:px-4">
            <h2 className="mr-auto flex items-center gap-2 text-sm font-semibold"><Terminal className="size-4 text-gold" aria-hidden="true" />{t("managementWorkspace.console")}</h2>
            <div className="w-full sm:w-auto">{controls ?? <div role="group" aria-label={t("managementWorkspace.serverControls")} className={`${segmentedGroupClass} w-full sm:w-auto`}>{[{ label: t("managementWorkspace.start"), icon: Play }, { label: t("managementWorkspace.stop"), icon: Square }, { label: t("managementWorkspace.restart"), icon: RotateCw }].map(({ label, icon: Icon }) => <button key={label} disabled className={`${segmentedButtonClass} flex-1 sm:flex-none`}><Icon className="size-3.5 shrink-0" aria-hidden="true" />{label}</button>)}</div>}</div>
        </div>
        <div role="log" aria-label={t("managementWorkspace.consoleOutput")} tabIndex={0} className="h-80 overflow-auto bg-surface-raised p-4 font-mono text-[13px] leading-7 text-foreground-muted outline-gold sm:h-96 sm:p-5 sm:text-sm">{t("managementWorkspace.consoleOutputIsNotConnectedForThisServer")}</div>
        <div className="flex gap-2 border-t border-white/10 p-5">
            <label className="sr-only" htmlFor="console-command">{t("managementWorkspace.consoleCommand")}</label>
            <input id="console-command" disabled placeholder={t("managementWorkspace.enterACommand")} className="w-full min-w-0 rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-40" />
            <button disabled className={`${button} !border-gold/50 !bg-gold/15 !text-gold`}>{t("managementWorkspace.send")}<ArrowUpRight className="size-4" aria-hidden="true" /></button>
        </div>
        <p className="px-5 pb-5 text-xs leading-5 text-foreground-muted">{t("managementWorkspace.consoleInputIsUnavailableUntilALiveConsoleIsConnected")}</p>
    </section>;
}

// Presents an unavailable task panel with disabled operations.
export function UnavailableServerPanel({ title, actions }: { title: string; actions: string[] }) {
    const { t } = useTranslations("server-common");
    return <section className="rounded-lg border border-white/10 bg-surface p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-foreground-muted">{t("managementWorkspace.notConnectedYetTheseFeaturesAreUnavailableForThisServer")}</p>
        <div className="mt-4 flex flex-wrap gap-2">{actions.map(action => <button key={action} disabled className={button}>{action}</button>)}</div>
    </section>;
}

/** Organizes server identity, join actions and persistent task panels in one workspace. */
export function ServerManagementWorkspace({ name, address, summary, status, visibility, notice, banner, initialSection = "Console", interactionLocked = false, children }: {
    name: ReactNode; address?: string | null; summary: ReactNode; status?: ReactNode; visibility?: ReactNode; notice?: string;
    /** Server notices shown above everything else on the page. */
    banner?: ReactNode;
    initialSection?: Section; interactionLocked?: boolean; children: ReactNode;
}) {
    const { t } = useTranslations("server-common");
    const [section, setSection] = useState<Section>(initialSection);
    const [showAddress, setShowAddress] = useState(false);
    const [addressEmphasis, setAddressEmphasis] = useState(false);
    const addressEmphasisTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [copyFeedback, setCopyFeedback] = useState<{ state: "copied" | "failed" } | null>(null);
    const copyState = copyFeedback?.state ?? "idle";
    const activeSection = interactionLocked ? "Console" : section;
    useEffect(() => {
        if (interactionLocked) return;
        // Restores a tab remembered in the URL unless the page already opened a specific one (such as access feedback).
        function followTab() {
            const remembered = serverWorkspaceSectionFromTab(new URLSearchParams(window.location.search).get(SERVER_WORKSPACE_TAB_PARAMETER));
            if (remembered && initialSection === "Console") setSection(remembered);
        }
        // Selects the existing workspace section for deep-linked server tasks.
        function followHash() {
            const target = window.location.hash;
            if (target === "#server-visibility") setSection("Settings");
            if (target === "#server-backups") setSection("Backups");
            if (target === "#server-files") setSection("Save & config");
            if (target === "#server-mods") setSection("Mods");
            if (target === "#server-lifecycle") setSection("Console");
        }
        followTab();
        followHash();
        window.addEventListener("hashchange", followHash);
        return () => window.removeEventListener("hashchange", followHash);
    }, [initialSection, interactionLocked]);
    useEffect(() => () => { if (addressEmphasisTimer.current !== null) clearTimeout(addressEmphasisTimer.current); }, []);
    useEffect(() => {
        if (copyFeedback === null) return;
        // Copy feedback is momentary; the button returns to its normal label.
        const timer = window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MILLISECONDS);
        return () => window.clearTimeout(timer);
    }, [copyFeedback]);

    // Shows a workspace tab and remembers it in the URL without a navigation or server request.
    function selectSection(next: Section) {
        setSection(next);
        const url = new URL(window.location.href);
        url.searchParams.set(SERVER_WORKSPACE_TAB_PARAMETER, serverWorkspaceTab(next));
        // A section hash would reopen its own tab on reload, contradicting the chosen one.
        url.hash = "";
        window.history.replaceState(null, "", url);
    }

    function revealAddress() {
        setShowAddress(true);
        setAddressEmphasis(true);
        if (addressEmphasisTimer.current !== null) clearTimeout(addressEmphasisTimer.current);
        addressEmphasisTimer.current = setTimeout(() => setAddressEmphasis(false), 6_000);
    }

    return <WorkspaceContext.Provider value={{ current: activeSection, initial: initialSection, revealAddress, address: address ?? null }}><main className="min-h-svh bg-background">
        <div className="site-container py-5 sm:py-6">
            <Link href="/servers" className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-gold"><ArrowLeft className="size-4" aria-hidden="true" />{t("managementWorkspace.allServers")}</Link>
            {banner}
            {notice && <p className="my-5 rounded-md border border-white/10 bg-surface px-4 py-3 text-sm leading-6 text-foreground-muted">{notice}</p>}
            <header className="mt-4 mb-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        {name}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-foreground-muted" onClick={event => {
                            // Reopening setup after switching tabs does not change an existing hash.
                            if (event.target instanceof Element && event.target.closest('a[href="#server-visibility"]')) setSection("Settings");
                        }}>{summary}{visibility}</div>
                    </div>
                    <div className="min-w-0 lg:pt-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span id="server-address" className={`font-mono ${addressEmphasis ? "animate-pulse text-gold drop-shadow-[0_0_8px_rgba(212,175,55,0.8)]" : "text-foreground-muted"}`} aria-live="polite">{address ? (showAddress ? address : t("managementWorkspace.ipHidden")) : t("managementWorkspace.notAssigned")}</span>
                            <button disabled={!address || interactionLocked} className={button} aria-controls="server-address" aria-expanded={showAddress} aria-label={showAddress ? t("managementWorkspace.hideServerIpAndPort") : t("managementWorkspace.showServerIpAndPort")} title={showAddress ? t("managementWorkspace.hideServerIpAndPort") : t("managementWorkspace.showServerIpAndPort")} onClick={() => setShowAddress(!showAddress)}>{showAddress ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button>
                            <button disabled={!address || interactionLocked} className={button} aria-live="polite" title={copyState === "failed" ? t("managementWorkspace.couldNotCopyRevealTheIpToCopyItManually") : t("managementWorkspace.copyServerIpAndPort")} onClick={async () => {
                                if (!address) return;
                                try { await navigator.clipboard.writeText(address); setCopyFeedback({ state: "copied" }); }
                                catch { setCopyFeedback({ state: "failed" }); }
                            }}><Copy className="size-4" aria-hidden="true" />{copyState === "copied" ? t("managementWorkspace.copied") : copyState === "failed" ? t("managementWorkspace.copyFailed") : t("managementWorkspace.copyIp")}</button>
                        </div>
                    </div>
                </div>
                {status && <div className="mt-4">{status}</div>}
            </header>
            <nav aria-label={t("managementWorkspace.serverWorkspace")} className="mb-4 grid grid-cols-5 border-b border-white/10 sm:flex sm:gap-1">
                {sections.map(({ name: label, label: messageKey, icon: Icon }) => <button key={label} disabled={interactionLocked && label !== "Console"} aria-current={activeSection === label ? "page" : undefined} onClick={() => selectSection(label)} className={`inline-flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-xs sm:min-h-12 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 ${activeSection === label ? "border-gold text-gold" : "border-transparent text-foreground-muted hover:text-foreground"}`}><Icon className="size-4" aria-hidden="true" />{t(messageKey)}</button>)}
            </nav>
            <div className="space-y-5">{children}</div>
        </div>
    </main></WorkspaceContext.Provider>;
}
