"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, Database, Download, FileJson, Globe2, LockKeyhole, Pencil, Play, RotateCw, Search, Settings2, Square, Terminal, Upload, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "@/app/lib/localization/client";

const sections = [
    { name: "Console", labelKey: "workspace.console", icon: Terminal },
    { name: "Backups", labelKey: "workspace.backups", icon: Database },
    { name: "Save & config", labelKey: "workspace.saveConfig", icon: FileJson },
    { name: "Settings", labelKey: "workspace.settings", icon: Settings2 },
] as const;
type Section = typeof sections[number]["name"];
type DemoBackup = { id: number; nameKey: string; hour: number | null; size: number; kind: "manual" | "automatic" };

// Deliberately illustrative, not a game command catalog or production config schema.
const commands = [
    { command: "help", descriptionKey: "commands.help.description", groupKey: "commands.group.information" },
    { command: "players", descriptionKey: "commands.players.description", groupKey: "commands.group.information" },
    { command: "save", descriptionKey: "commands.save.description", groupKey: "commands.group.campaign" },
    { command: 'announce "Welcome to the campaign!"', descriptionKey: "commands.announce.description", groupKey: "commands.group.players" },
];
const initialConfig = JSON.stringify({ maxPlayers: 8, autoSaveMinutes: 15, friendlyFire: false }, null, 2);
const initialLogs = [
    "[14:32:01] INFO  Server ready. Waiting for players…",
    "[14:32:04] INFO  Loaded campaign: The Northern March",
    "[14:33:12] JOIN  Aldric joined (1/8)",
    "[14:33:48] JOIN  Mira joined (2/8)",
    "[14:35:06] JOIN  Olek joined (3/8)",
    "[14:41:22] JOIN  Rowan joined (4/8)",
    "[14:45:00] SAVE  Autosave completed",
    "[14:45:01] INFO  Campaign running normally",
];
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} !border-gold/50 !bg-gold/15 !text-gold`;
const input = "w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold";
const destructive = `${button} !border-amber-400/30 !text-amber-200`;
const lifecycleButton = "!gap-1 !px-2 !text-xs sm:!gap-2 sm:!px-3 sm:!text-sm";
const confirmation = "mt-4 rounded-md border border-amber-400/25 bg-amber-400/5 p-4";

/** Announces localized demo feedback and exposes its dismiss control. */
function Feedback({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
    const { t } = useTranslations("server-wireframe");
    return <div role="status">{message && <p className="mt-3 flex items-start gap-3 text-sm leading-6 text-foreground-muted">
        <span className="min-w-0 break-words">{message}</span>
        {onDismiss && <button className="shrink-0 rounded p-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold" aria-label={t("feedback.dismiss")} onClick={onDismiss}><X className="size-4" aria-hidden="true" /></button>}
    </p>}</div>;
}

/** Shows the localized draft status and supplied save actions. */
function SaveBar({ dirty, message, children }: { dirty: boolean; message: string; children: ReactNode }) {
    const { t } = useTranslations("server-wireframe");
    return <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-white/10 bg-surface px-5 py-4">
        <div className="min-w-0 basis-full text-sm sm:flex-1">
            <p className="text-foreground-muted">{dirty ? t("draft.unsaved") : t("draft.clean")}</p>
            <Feedback message={message} />
        </div>
        {dirty && <div className="ml-auto flex gap-2">{children}</div>}
    </div>;
}

/** Presents a titled workspace panel with optional description and actions. */
function Panel({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
    return <section className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <div><h2 className="text-base font-semibold">{title}</h2>{description && <p className="mt-1 text-sm leading-6 text-foreground-muted">{description}</p>}</div>
            {action}
        </div>
        {children}
    </section>;
}

/** Runs the public, local-only management demo using page-scoped messages. */
export default function ServerWireframe() {
    const { t, number, date } = useTranslations("server-wireframe");
    const [section, setSection] = useState<Section>("Console");
    const [running, setRunning] = useState(true);
    const [pendingLifecycle, setPendingLifecycle] = useState<"stop" | "restart" | null>(null);
    const [lifecycleNotice, setLifecycleNotice] = useState("");
    const startButton = useRef<HTMLButtonElement>(null);
    const stopButton = useRef<HTMLButtonElement>(null);
    const restartButton = useRef<HTMLButtonElement>(null);
    const lifecycleCancel = useRef<HTMLButtonElement>(null);
    const [showAddress, setShowAddress] = useState(false);
    const [name, setName] = useState("The Northern March");
    const [draftName, setDraftName] = useState(name);
    const [visibility, setVisibility] = useState("private");
    const [draftVisibility, setDraftVisibility] = useState(visibility);
    const [consoleNotice, setConsoleNotice] = useState("");
    const [backupNotice, setBackupNotice] = useState("");
    const [settingsNotice, setSettingsNotice] = useState("");
    const settingsName = useRef<HTMLInputElement>(null);
    const restoreButton = useRef<HTMLButtonElement | null>(null);
    const [headerNotice, setHeaderNotice] = useState("");
    const [editingName, setEditingName] = useState(false);
    const [inlineName, setInlineName] = useState(name);
    const nameButton = useRef<HTMLButtonElement>(null);
    const visibilityPicker = useRef<HTMLDetailsElement>(null);
    const [commandsOpen, setCommandsOpen] = useState(false);
    const logViewport = useRef<HTMLDivElement>(null);
    const [followingLogs, setFollowingLogs] = useState(true);
    const [logs, setLogs] = useState(initialLogs);
    const [command, setCommand] = useState("");
    const [search, setSearch] = useState("");
    const commandInput = useRef<HTMLInputElement>(null);
    const [backups, setBackups] = useState<DemoBackup[]>([
        { id: 2, nameKey: "backups.beforeSession", hour: 14, size: 24.8, kind: "manual" },
        { id: 1, nameKey: "backups.scheduled", hour: 6, size: 24.6, kind: "automatic" },
    ]);
    const [restoreId, setRestoreId] = useState<number | null>(null);
    const [config, setConfig] = useState(initialConfig);
    const [savedConfig, setSavedConfig] = useState(initialConfig);
    const [configError, setConfigError] = useState("");
    const [configNotice, setConfigNotice] = useState("");
    const [saveNotice, setSaveNotice] = useState("");
    const saveImport = useRef<HTMLInputElement>(null);
    const configImport = useRef<HTMLInputElement>(null);
    const jsonEditor = useRef<HTMLTextAreaElement>(null);
    const saveImportButton = useRef<HTMLButtonElement>(null);
    const [editor, setEditor] = useState("json");
    const [saveFile, setSaveFile] = useState("");
    const [activeSave, setActiveSave] = useState("northern-march.sav");
    const configDirty = config !== savedConfig;
    const settingsDirty = draftName.trim() !== name || draftVisibility !== visibility;

    useEffect(() => {
        const viewport = logViewport.current;
        if (viewport && followingLogs) viewport.scrollTop = viewport.scrollHeight;
    }, [logs, section, followingLogs]);

    useEffect(() => {
        if (pendingLifecycle) lifecycleCancel.current?.focus();
    }, [pendingLifecycle]);

    /** Updates only demo lifecycle state and preserves the illustrative log payload. */
    function applyLifecycle(action: "start" | "stop" | "restart") {
        const result = action === "start" ? "started" : action === "stop" ? "stopped" : "restarted";
        setRunning(action !== "stop");
        setPendingLifecycle(null);
        setLifecycleNotice(t(`lifecycle.${action}Notice`));
        setLogs((previous) => [...previous, `[DEMO] Server ${result} locally. No live server was changed.`]);
        requestAnimationFrame(() => (action === "stop" ? startButton : action === "start" ? stopButton : restartButton).current?.focus());
    }

    /** Cancels the local confirmation and restores focus to its trigger. */
    function cancelLifecycle() {
        const trigger = pendingLifecycle === "stop" ? stopButton : restartButton;
        setPendingLifecycle(null);
        requestAnimationFrame(() => trigger.current?.focus());
    }

    /** Closes the name editor and restores focus without altering the entered name. */
    function finishNameEdit() {
        setEditingName(false);
        requestAnimationFrame(() => nameButton.current?.focus());
    }

    /** Inserts immutable command syntax and selects its editable argument. */
    function insertCommand(value: string) {
        setCommand(value);
        setCommandsOpen(false);
        requestAnimationFrame(() => {
            const field = commandInput.current;
            field?.focus();
            const argumentStart = value.indexOf('"');
            field?.setSelectionRange(argumentStart < 0 ? value.length : argumentStart + 1,
                argumentStart < 0 ? value.length : value.lastIndexOf('"'));
        });
    }

    const matchingCommands = commands.filter((item) =>
        `${item.command} ${t(item.descriptionKey)} ${t(item.groupKey)}`.toLowerCase().includes(search.toLowerCase()),
    );

    /** Validates a JSON object without modifying file contents and reports localized errors. */
    function validConfig(text: string) {
        setConfigNotice("");
        try {
            const value: unknown = JSON.parse(text);
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
            setConfigError("");
            return true;
        } catch {
            setConfigError(t("config.invalid"));
            return false;
        }
    }

    /** Downloads the unchanged demo log payload and announces completion. */
    function downloadLogs() {
        const url = URL.createObjectURL(new Blob([logs.join("\n") + "\n"], { type: "text/plain" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "wireframe-server.log";
        link.click();
        URL.revokeObjectURL(url);
        setConsoleNotice(t("console.downloaded"));
    }

    /** Exports the validated draft verbatim and announces completion. */
    function exportConfig() {
        if (!validConfig(config)) return;
        const url = URL.createObjectURL(new Blob([config], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "wireframe-config.json";
        link.click();
        URL.revokeObjectURL(url);
        setConfigNotice(t("config.exported"));
    }

    return <main className="min-h-svh bg-background pb-12">
        <div className="border-b border-white/10 bg-white/[0.03]">
            <div className="site-container flex flex-wrap items-center justify-between gap-2 py-3 text-xs leading-5">
                <p><strong className="font-semibold uppercase tracking-wider text-foreground-muted">{t("banner.title")}</strong><span className="mx-3 text-white/25">/</span>{t("banner.access")}</p>
                <span className="text-foreground-muted">{t("banner.reset")}</span>
            </div>
        </div>
        <div className="site-container">
            <div className="flex items-center gap-2 py-4 text-sm text-foreground-muted">
                <Link href="/servers" className="inline-flex items-center gap-2 hover:text-gold"><ArrowLeft className="size-4" aria-hidden="true" />{t("breadcrumb.servers")}</Link>
                <ChevronRight className="size-3" aria-hidden="true" /><span>{t("breadcrumb.preview")}</span>
            </div>
            <header className="pb-4">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
                    <span role="status" className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${running ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-white/15 bg-white/5 text-foreground-muted"}`}><span className={`size-1.5 rounded-full ${running ? "bg-emerald-400" : "bg-foreground-muted"}`} />{t(running ? "lifecycle.running" : "lifecycle.stopped")}</span>
                    <span className="hidden text-foreground-muted sm:inline">{t("header.region")}</span>
                    <details ref={visibilityPicker} className="relative ml-auto" onKeyDown={(event) => {
                        if (event.key === "Escape" && visibilityPicker.current) {
                            visibilityPicker.current.open = false;
                            visibilityPicker.current.querySelector("summary")?.focus();
                        }
                    }}>
                        <summary aria-label={t(`visibility.${visibility}Edit`)} className={`${button} list-none [&::-webkit-details-marker]:hidden`}>
                            {visibility === "public" ? <Globe2 className="size-4" aria-hidden="true" /> : <LockKeyhole className="size-4" aria-hidden="true" />}
                            {visibility === "public" ? t("visibility.public") : t("visibility.private")}<ChevronDown className="size-3" aria-hidden="true" />
                        </summary>
                        <div className="absolute right-0 z-10 mt-2 w-40 rounded-lg border border-white/15 bg-surface-raised p-1 shadow-xl">
                            <div role="group" aria-label={t("visibility.label")}>{["private", "public"].map((value) => <button key={value} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-gold" aria-pressed={visibility === value} onClick={() => {
                                setVisibility(value); setDraftVisibility(value); setSettingsNotice("");
                                setHeaderNotice(t(`visibility.${value}Notice`));
                                if (visibilityPicker.current) {
                                    visibilityPicker.current.open = false;
                                    visibilityPicker.current.querySelector("summary")?.focus();
                                }
                            }}>{value === "private" ? <LockKeyhole className="size-4 text-foreground-muted" aria-hidden="true" /> : <Globe2 className="size-4 text-foreground-muted" aria-hidden="true" />}{value === "private" ? t("visibility.private") : t("visibility.public")}{visibility === value && <Check className="ml-auto size-4" aria-hidden="true" />}</button>)}</div>
                        </div>
                    </details>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                            <h1 className="min-w-0 break-words font-display text-2xl font-semibold sm:text-4xl">{name}</h1>
                            {!editingName && <button ref={nameButton} className={`${button} shrink-0`} aria-label={t("server.editName")} onClick={() => { setInlineName(name); setEditingName(true); }}><Pencil className="size-4" aria-hidden="true" /></button>}
                        </div>
                        {editingName && <form className="mt-3 flex max-w-xl flex-wrap items-center gap-2" onSubmit={(event) => {
                            event.preventDefault();
                            if (!inlineName.trim()) return;
                            setName(inlineName.trim());
                            setDraftName(inlineName.trim());
                            setSettingsNotice("");
                            setHeaderNotice(t("server.nameSaved"));
                            finishNameEdit();
                        }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); finishNameEdit(); } }}>
                            <label htmlFor="inline-server-name" className="sr-only">{t("server.name")}</label>
                            <input id="inline-server-name" autoFocus required maxLength={80} value={inlineName} onChange={(event) => setInlineName(event.target.value)} className={`${input} !w-auto min-w-0 flex-1`} />
                            <button type="button" className={button} onClick={finishNameEdit}>{t("action.cancel")}</button>
                            <button type="submit" disabled={!inlineName.trim()} className={primary}>{t("server.saveName")}</button>
                        </form>}
                    </div>

                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-foreground-muted">{t("address.label")}</span>
                    <span id="server-address" className="font-mono text-sm" aria-live="polite">{showAddress ? "203.0.113.42:7210" : t("address.hidden")}</span>
                    <button className={button} aria-controls="server-address" aria-expanded={showAddress} aria-label={t(showAddress ? "address.hideLabel" : "address.showLabel")} onClick={() => setShowAddress((previous) => !previous)}>{t(showAddress ? "address.hide" : "address.show")}</button>
                    <button className={button} title={t("address.copyTitle")} onClick={async () => {
                        try {
                            await navigator.clipboard.writeText("203.0.113.42:7210");
                            setHeaderNotice(t("address.copied"));
                        } catch {
                            setHeaderNotice(t("address.copyFailed"));
                        }
                    }}><Copy className="size-4" aria-hidden="true" />{t("address.copy")}</button>
                </div>
                <Feedback message={headerNotice} onDismiss={() => setHeaderNotice("")} />
            </header>
            <nav aria-label={t("workspace.label")} className="mb-5 grid grid-cols-4 border-b border-white/10 sm:flex sm:gap-1">
                {sections.map(({ name: label, labelKey, icon: Icon }) => <button key={label} aria-current={section === label ? "page" : undefined} onClick={() => { setSection(label); setPendingLifecycle(null); setLifecycleNotice(""); setConsoleNotice(""); setBackupNotice(""); setSettingsNotice(""); setSaveNotice(""); setConfigNotice(""); }} className={`relative inline-flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-xs leading-4 transition sm:min-h-12 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm focus-visible:outline-2 focus-visible:outline-gold ${section === label ? "border-gold text-gold" : "border-transparent text-foreground-muted hover:text-foreground"}`}>
                    <Icon className="size-4" aria-hidden="true" />{t(labelKey)}{((label === "Save & config" && configDirty) || (label === "Settings" && settingsDirty)) && <span aria-label={t("draft.unsaved")} className="absolute right-2 top-2 size-1.5 rounded-full bg-gold sm:static" />}
                </button>)}
            </nav>

            {section === "Console" && <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Panel title={t("console.title")} action={<button className={`${button} !border-transparent !bg-transparent !text-foreground-muted hover:!text-foreground`} onClick={downloadLogs}><Download className="size-4" aria-hidden="true" />{t("console.download")}</button>}>
                    <div className="border-b border-white/10 px-5 py-3">
                        <div role="group" aria-label={t("console.controls")} className="grid grid-cols-3 gap-2 sm:flex">
                            <button ref={startButton} className={`${running ? button : primary} ${lifecycleButton}`} disabled={running || pendingLifecycle !== null} onClick={() => applyLifecycle("start")}><Play className="size-3.5 shrink-0 sm:size-4" aria-hidden="true" />{t("lifecycle.start")}</button>
                            <button ref={stopButton} className={`${button} ${lifecycleButton}`} disabled={!running || pendingLifecycle !== null} onClick={() => { setLifecycleNotice(""); setPendingLifecycle("stop"); }}><Square className="size-3.5 shrink-0 sm:size-4" aria-hidden="true" />{t("lifecycle.stop")}</button>
                            <button ref={restartButton} className={`${button} ${lifecycleButton}`} disabled={!running || pendingLifecycle !== null} onClick={() => { setLifecycleNotice(""); setPendingLifecycle("restart"); }}><RotateCw className="size-3.5 shrink-0 sm:size-4" aria-hidden="true" />{t("lifecycle.restart")}</button>
                        </div>
                        {pendingLifecycle && <div className={confirmation} role="group" aria-labelledby="lifecycle-confirmation" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelLifecycle(); } }}>
                            <h3 id="lifecycle-confirmation" className="text-sm font-semibold">{t(`lifecycle.${pendingLifecycle}Title`)}</h3>
                            <p className="mt-2 text-sm leading-6 text-foreground-muted">{t(`lifecycle.${pendingLifecycle}Warning`)}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button ref={lifecycleCancel} className={button} onClick={cancelLifecycle}>{t("action.cancel")}</button>
                                <button className={destructive} onClick={() => applyLifecycle(pendingLifecycle)}>{pendingLifecycle === "stop" ? t("lifecycle.stopAction") : t("lifecycle.restartAction")}</button>
                            </div>
                        </div>}
                        <Feedback message={lifecycleNotice} />
                    </div>
                    <div className="relative">
                        <div ref={logViewport} role="log" aria-label={t("console.output")} aria-live="polite" tabIndex={0} onScroll={(event) => {
                            const viewport = event.currentTarget;
                            setFollowingLogs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 24);
                        }} className="h-80 overflow-auto bg-surface-raised p-4 font-mono text-[13px] leading-7 outline-gold sm:h-96 sm:p-5 sm:text-sm">
                            {logs.map((line, i) => {
                                const timestamp = line.match(/^\[\d{2}:\d{2}:\d{2}\] /)?.[0];
                                return <p key={i} className="whitespace-pre-wrap break-words text-foreground"><span className="text-foreground-muted">{timestamp}</span>{line.slice(timestamp?.length ?? 0)}</p>;
                            })}
                        </div>
                        {!followingLogs && <button className={`${button} absolute right-4 bottom-3 !bg-surface-raised shadow-lg`} onClick={() => setFollowingLogs(true)}>{t("console.latest")} <ChevronDown className="size-4" aria-hidden="true" /></button>}
                    </div>
                    <form className="flex gap-2 border-t border-white/10 p-5" onSubmit={(event) => {
                        event.preventDefault();
                        if (!running || !command.trim()) return;
                        setLogs((previous) => [...previous, `> ${command.trim()}`, "[DEMO] Command received locally. Nothing was sent to a server."]);
                        setCommand("");
                    }}>
                        <label className="sr-only" htmlFor="console-command">{t("console.commandLabel")}</label>
                        <input ref={commandInput} id="console-command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder={t("console.placeholder")} autoComplete="off" className={`${input} min-w-0 font-mono`} />
                        <button type="submit" disabled={!running || !command.trim()} className={primary}>{t("console.send")} <ArrowUpRight className="size-4" aria-hidden="true" /></button>
                    </form>
                    <div className="px-5 pb-5">
                        <p className="text-xs leading-5 text-foreground-muted">{running ? t("console.runningHelp") : t("console.stoppedHelp")}</p>
                        <Feedback message={consoleNotice} />
                    </div>
                </Panel>
                <aside className="min-w-0 rounded-lg border border-white/10 bg-surface" aria-label={t("commands.label")}>
                    <div className="hidden border-b border-white/10 p-5 lg:block"><h2 className="text-base font-semibold">{t("commands.title")}</h2><p className="mt-1 text-sm text-foreground-muted">{t("commands.instructions")}</p></div>
                    <button className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-gold lg:hidden" aria-expanded={commandsOpen} aria-controls="command-picker" onClick={() => setCommandsOpen((previous) => !previous)}>{t("commands.browse")} <ChevronDown className={`size-4 transition-transform ${commandsOpen ? "rotate-180" : ""}`} aria-hidden="true" /></button>
                    <div id="command-picker" className={`${commandsOpen ? "block" : "hidden"} p-5 lg:block`}>
                        <label htmlFor="command-search" className="sr-only">{t("commands.searchLabel")}</label>
                        <div className="relative"><Search className="absolute top-3 left-3 size-4 text-foreground-muted" aria-hidden="true" /><input id="command-search" className={`${input} pl-9`} placeholder={t("commands.searchPlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                        <div className="mt-4 space-y-4">
                            {[...new Set(matchingCommands.map((item) => item.groupKey))].map((group) => <section key={group}>
                                <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-foreground-muted">{t(group)}</h3>
                                <ul className="divide-y divide-white/10">{matchingCommands.filter((item) => item.groupKey === group).map((item) => <li key={item.command}><button className="group flex w-full items-center justify-between gap-3 rounded px-1 py-3 text-left hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-gold" aria-label={t("commands.insert", { command: item.command.split(" ")[0] })} onClick={() => insertCommand(item.command)}>
                                    <span><code className="block text-sm text-foreground">{item.command.split(" ")[0]}</code><span className="mt-1 block text-[13px] leading-5 text-foreground-muted">{t(item.descriptionKey)}</span></span>
                                    <ChevronRight className="size-4 shrink-0 text-foreground-muted group-hover:text-gold" aria-hidden="true" />
                                </button></li>)}</ul>
                            </section>)}
                            {!matchingCommands.length && <p className="py-4 text-sm text-foreground-muted">{t("commands.empty")}</p>}
                        </div>
                    </div>
                </aside>
            </div>}

            {section === "Backups" && <Panel title={t("backups.title")} description={t("backups.description")} action={<button className={primary} onClick={() => {
                setBackups((previous) => [{ id: Date.now(), nameKey: "backups.manualName", hour: null, size: 24.8, kind: "manual" }, ...previous]);
                setBackupNotice(t("backups.created"));
            }}><Database className="size-4" aria-hidden="true" />{t("backups.create")}</button>}>
                <div className="border-b border-white/10 px-5 py-4">
                    <p className="text-sm text-foreground-muted">{t("backups.policy", { time: date(Date.UTC(2000, 0, 1, 6), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), days: number(7) })}</p>
                    <Feedback message={backupNotice} />
                </div>
                <ul className="divide-y divide-white/10 px-5">{backups.map((backup) => <li key={backup.id} className="py-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div><h3 className="text-sm font-medium">{t(backup.nameKey)}</h3><p className="mt-1 text-xs text-foreground-muted">{t("backups.details", { date: backup.hour === null ? t("backups.justNow") : t("backups.today", { time: date(Date.UTC(2000, 0, 1, backup.hour), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) }), size: number(backup.size, { style: "unit", unit: "megabyte", unitDisplay: "short" }), kind: t(`backups.${backup.kind}`) })}</p></div>
                        <button className={button} aria-label={t("backups.restoreLabel", { name: t(backup.nameKey) })} onClick={(event) => { restoreButton.current = event.currentTarget; setBackupNotice(""); setRestoreId(backup.id); }}>{t("backups.restore")}</button>
                    </div>
                    {restoreId === backup.id && <div className={confirmation}>
                        <h4 className="text-sm font-semibold">{t("backups.restoreTitle", { name: t(backup.nameKey) })}</h4><p className="mt-2 text-sm leading-6 text-foreground-muted">{t("backups.warning")}</p>
                        <div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={() => { setRestoreId(null); restoreButton.current?.focus(); }}>{t("action.cancel")}</button><button className={destructive} onClick={() => { setRestoreId(null); setBackupNotice(t("backups.restored", { name: t(backup.nameKey) })); restoreButton.current?.focus(); }}>{t("backups.confirm")}</button></div>
                    </div>}
                </li>)}</ul>
            </Panel>}

            {section === "Save & config" && <div className="space-y-5">
                <section aria-labelledby="campaign-save-heading" className="rounded-lg border border-white/10 bg-surface p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0">
                            <h2 id="campaign-save-heading" className="text-base font-semibold">{t("save.title")}</h2>
                            <p className="mt-2 break-all font-mono text-sm">{activeSave}</p>
                            <p className="mt-1 text-xs text-foreground-muted">{t("save.details", { size: number(24.8, { style: "unit", unit: "megabyte", unitDisplay: "short" }), minutes: number(2) })}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button className={button} onClick={() => setSaveNotice(t("save.exportNotice"))}><Download className="size-4" aria-hidden="true" />{t("save.export")}</button>
                            <button ref={saveImportButton} className={button} onClick={() => saveImport.current?.click()}><Upload className="size-4" aria-hidden="true" />{t("save.import")}</button>
                            <input ref={saveImport} id="save-import" type="file" hidden aria-label={t("save.importLabel")} onChange={(event) => {
                                setSaveFile(event.target.files?.[0]?.name ?? "");
                                setSaveNotice("");
                                event.target.value = "";
                            }} />
                        </div>
                    </div>
                    {saveFile && <div className={confirmation}>
                        <h3 className="break-words text-sm font-semibold">{t("save.replaceTitle", { filename: saveFile })}</h3>
                        <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("save.warning")}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button className={button} onClick={() => { setSaveFile(""); saveImportButton.current?.focus(); }}>{t("action.cancel")}</button>
                            <button className={destructive} onClick={() => { setActiveSave(saveFile); setSaveFile(""); setSaveNotice(t("save.replaced")); saveImportButton.current?.focus(); }}>{t("save.replace")}</button>
                        </div>
                    </div>}
                    <Feedback message={saveNotice} />
                </section>
                <Panel title={t("config.title")} description={t("draft.help")}>
                    <div className="p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex gap-2" role="group" aria-label={t("config.mode")}>
                                <button aria-pressed={editor === "json"} className={editor === "json" ? primary : button} onClick={() => setEditor("json")}>{t("config.json")}{configDirty && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-gold sm:static" aria-label={t("draft.unsaved")} />}</button>
                                <button aria-pressed={editor === "form"} className={editor === "form" ? primary : button} onClick={() => setEditor("form")}>{t("config.form")}</button>
                            </div>
                            {editor === "json" && <div className="flex gap-2">
                                <button className={button} onClick={() => configImport.current?.click()}><Upload className="size-4" aria-hidden="true" />{t("config.import")}</button>
                                <button className={button} onClick={exportConfig}><Download className="size-4" aria-hidden="true" />{t("config.export")}</button>
                            </div>}
                            <input ref={configImport} id="config-import" type="file" hidden accept=".json,application/json" aria-label={t("config.importLabel")} onChange={async (event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (!file) return;
                                try {
                                    const text = await file.text();
                                    setEditor("json");
                                    if (!validConfig(text)) return;
                                    setConfig(text);
                                    setConfigNotice(t("config.imported"));
                                } catch { setConfigNotice(""); setConfigError(t("config.readFailed")); }
                            }} />
                        </div>
                        {editor === "json" ? <>
                            <label htmlFor="config-json" className="mb-2 block text-xs text-foreground-muted">config.json</label>
                            <textarea ref={jsonEditor} id="config-json" spellCheck={false} value={config} onChange={(event) => { setConfig(event.target.value); setConfigError(""); setConfigNotice(""); }} aria-invalid={!!configError} aria-describedby={configError ? "config-error config-help" : "config-help"} className={`${input} min-h-64 resize-y font-mono leading-7`} />
                            <p id="config-help" className="mt-3 text-xs leading-5 text-foreground-muted">{t("config.help")}</p>
                            {configError && <p id="config-error" role="alert" className="mt-3 text-sm text-red-300">{configError}</p>}
                        </> : <div className="rounded-md border border-white/10 bg-white/[0.02] p-5">
                            <span className="inline-flex rounded bg-white/5 px-2 py-1 text-xs text-foreground-muted">{t("config.notInteractive")}</span>
                            <p className="mt-3 text-sm leading-6 text-foreground-muted">{t("config.formHelp")}</p>
                            <fieldset disabled className="mt-5 grid gap-5 sm:grid-cols-2">
                                <legend className="sr-only">{t("config.fields")}</legend>
                                <label className="text-sm">{t("config.maxPlayers")}<input type="number" defaultValue={8} className={`${input} mt-2 opacity-50`} /></label>
                                <label className="text-sm">{t("config.autosave")}<input type="number" defaultValue={15} className={`${input} mt-2 opacity-50`} /></label>
                                <label className="flex items-center gap-2 text-sm"><input type="checkbox" />{t("config.friendlyFire")}</label>
                            </fieldset>
                        </div>}
                    </div>
                    {editor === "json" && <SaveBar dirty={configDirty} message={configNotice}>
                        <button className={button} onClick={() => { setConfig(savedConfig); setConfigError(""); setConfigNotice(t("draft.discarded")); jsonEditor.current?.focus(); }}>{t("action.discard")}</button>
                        <button className={primary} onClick={() => {
                            if (!validConfig(config)) { jsonEditor.current?.focus(); return; }
                            setSavedConfig(config);
                            setConfigNotice(t("config.saved"));
                            jsonEditor.current?.focus({ preventScroll: true });
                        }}>{t("config.save")}</button>
                    </SaveBar>}
                </Panel>
            </div>}

            {section === "Settings" && <Panel title={t("settings.title")} description={t("draft.help")}>
                <form onSubmit={(event) => { event.preventDefault(); if (!draftName.trim()) return; setName(draftName.trim()); setDraftName(draftName.trim()); setVisibility(draftVisibility); setSettingsNotice(t("settings.saved")); settingsName.current?.focus({ preventScroll: true }); }}>
                    <div className="max-w-3xl space-y-5 p-5">
                    <div><label htmlFor="server-name" className="text-sm font-medium">{t("server.name")}</label><input ref={settingsName} id="server-name" required maxLength={80} value={draftName} onChange={(event) => { setDraftName(event.target.value); setSettingsNotice(""); }} className={`${input} mt-2`} /><p className="mt-2 text-xs leading-5 text-foreground-muted">{t("settings.nameHelp")}</p></div>
                    <fieldset><legend className="text-sm font-medium">{t("visibility.label")}</legend><p className="mt-2 text-sm leading-6 text-foreground-muted">{t("visibility.help")}</p><div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {[{ value: "private", title: t("visibility.private"), description: t("visibility.privateHelp"), icon: LockKeyhole }, { value: "public", title: t("visibility.public"), description: t("visibility.publicHelp"), icon: Globe2 }].map(({ value, title, description, icon: Icon }) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${draftVisibility === value ? "border-gold/50 bg-gold/5" : "border-white/10"}`}><input type="radio" name="visibility" value={value} checked={draftVisibility === value} onChange={() => { setDraftVisibility(value); setSettingsNotice(""); }} className="mt-1 accent-gold" /><span><span className="flex items-center gap-2 text-sm font-medium"><Icon className={`size-4 ${draftVisibility === value ? "text-gold" : "text-foreground-muted"}`} aria-hidden="true" />{title}</span><span className="mt-2 block text-xs leading-5 text-foreground-muted">{description}</span></span></label>)}
                    </div></fieldset>
                    </div>
                    <SaveBar dirty={settingsDirty} message={settingsNotice}>
                        <button type="button" className={button} onClick={() => { setDraftName(name); setDraftVisibility(visibility); setSettingsNotice(t("draft.discarded")); settingsName.current?.focus(); }}>{t("action.discard")}</button>
                        <button type="submit" disabled={!draftName.trim()} className={primary}>{t("settings.save")}</button>
                    </SaveBar>
                </form>
            </Panel>}
        </div>
    </main>;
}
