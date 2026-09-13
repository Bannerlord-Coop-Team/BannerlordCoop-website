"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, Database, Download, FileJson, Globe2, LockKeyhole, Pencil, Search, Settings2, Terminal, Upload, X } from "lucide-react";
import Link from "next/link";

const sections = [
    { name: "Console", icon: Terminal },
    { name: "Backups", icon: Database },
    { name: "Save & config", icon: FileJson },
    { name: "Settings", icon: Settings2 },
] as const;
type Section = typeof sections[number]["name"];

// Deliberately illustrative, not a game command catalog or production config schema.
const commands = [
    { command: "help", description: "List available console commands", group: "Information" },
    { command: "players", description: "Show connected players", group: "Information" },
    { command: "save", description: "Save the current campaign", group: "Campaign" },
    { command: 'announce "Welcome to the campaign!"', description: "Send a message to all players", group: "Players" },
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
const confirmation = "mt-4 rounded-md border border-amber-400/25 bg-amber-400/5 p-4";

function Feedback({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
    return <div role="status">{message && <p className="mt-3 flex items-start gap-3 text-sm leading-6 text-foreground-muted">
        <span className="min-w-0 break-words">{message}</span>
        {onDismiss && <button className="shrink-0 rounded p-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold" aria-label="Dismiss notification" onClick={onDismiss}><X className="size-4" aria-hidden="true" /></button>}
    </p>}</div>;
}

function SaveBar({ dirty, message, children }: { dirty: boolean; message: string; children: ReactNode }) {
    return <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-white/10 bg-surface px-5 py-4">
        <div className="min-w-0 basis-full text-sm sm:flex-1">
            <p className="text-foreground-muted">{dirty ? "Unsaved changes" : "No pending changes"}</p>
            <Feedback message={message} />
        </div>
        {dirty && <div className="ml-auto flex gap-2">{children}</div>}
    </div>;
}

function Panel({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
    return <section className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <div><h2 className="text-base font-semibold">{title}</h2>{description && <p className="mt-1 text-sm leading-6 text-foreground-muted">{description}</p>}</div>
            {action}
        </div>
        {children}
    </section>;
}

export default function ServerWireframe() {
    const [section, setSection] = useState<Section>("Console");
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
    const [backups, setBackups] = useState([
        { id: 2, name: "Before tonight’s session", date: "Today, 14:00", size: "24.8 MB", kind: "Manual" },
        { id: 1, name: "Scheduled backup", date: "Today, 06:00", size: "24.6 MB", kind: "Automatic" },
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

    function finishNameEdit() {
        setEditingName(false);
        requestAnimationFrame(() => nameButton.current?.focus());
    }

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
        `${item.command} ${item.description} ${item.group}`.toLowerCase().includes(search.toLowerCase()),
    );

    function validConfig(text: string) {
        setConfigNotice("");
        try {
            const value: unknown = JSON.parse(text);
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
            setConfigError("");
            return true;
        } catch {
            setConfigError("Enter a valid JSON object. Your draft has not been saved.");
            return false;
        }
    }

    function downloadLogs() {
        const url = URL.createObjectURL(new Blob([logs.join("\n") + "\n"], { type: "text/plain" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "wireframe-server.log";
        link.click();
        URL.revokeObjectURL(url);
        setConsoleNotice("Logs downloaded, including commands entered this session.");
    }

    function exportConfig() {
        if (!validConfig(config)) return;
        const url = URL.createObjectURL(new Blob([config], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "wireframe-config.json";
        link.click();
        URL.revokeObjectURL(url);
        setConfigNotice("Config draft exported. Unsaved changes are included.");
    }

    return <main className="min-h-svh bg-background pb-12">
        <div className="border-b border-white/10 bg-white/[0.03]">
            <div className="site-container flex flex-wrap items-center justify-between gap-2 py-3 text-xs leading-5">
                <p><strong className="font-semibold uppercase tracking-wider text-foreground-muted">Public wireframe</strong><span className="mx-3 text-white/25">/</span>No sign-in · No live connections</p>
                <span className="text-foreground-muted">Local demo only — refresh to reset</span>
            </div>
        </div>
        <div className="site-container">
            <div className="flex items-center gap-2 py-4 text-sm text-foreground-muted">
                <Link href="/servers" className="inline-flex items-center gap-2 hover:text-gold"><ArrowLeft className="size-4" aria-hidden="true" /> Servers</Link>
                <ChevronRight className="size-3" aria-hidden="true" /><span>Design preview</span>
            </div>
            <header className="pb-4">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
                    <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400" />Running · demo</span>
                    <span className="hidden text-foreground-muted sm:inline">EU West · Campaign server</span>
                    <details ref={visibilityPicker} className="relative ml-auto" onKeyDown={(event) => {
                        if (event.key === "Escape" && visibilityPicker.current) {
                            visibilityPicker.current.open = false;
                            visibilityPicker.current.querySelector("summary")?.focus();
                        }
                    }}>
                        <summary aria-label={`Directory visibility: ${visibility}. Edit visibility`} className={`${button} list-none [&::-webkit-details-marker]:hidden`}>
                            {visibility === "public" ? <Globe2 className="size-4" aria-hidden="true" /> : <LockKeyhole className="size-4" aria-hidden="true" />}
                            {visibility === "public" ? "Public" : "Private"}<ChevronDown className="size-3" aria-hidden="true" />
                        </summary>
                        <div className="absolute right-0 z-10 mt-2 w-40 rounded-lg border border-white/15 bg-surface-raised p-1 shadow-xl">
                            <div role="group" aria-label="Directory visibility">{["private", "public"].map((value) => <button key={value} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-gold" aria-pressed={visibility === value} onClick={() => {
                                setVisibility(value); setDraftVisibility(value); setSettingsNotice("");
                                setHeaderNotice(`Visibility set to ${value} in this demo. Nothing was published.`);
                                if (visibilityPicker.current) {
                                    visibilityPicker.current.open = false;
                                    visibilityPicker.current.querySelector("summary")?.focus();
                                }
                            }}>{value === "private" ? <LockKeyhole className="size-4 text-foreground-muted" aria-hidden="true" /> : <Globe2 className="size-4 text-foreground-muted" aria-hidden="true" />}{value === "private" ? "Private" : "Public"}{visibility === value && <Check className="ml-auto size-4" aria-hidden="true" />}</button>)}</div>
                        </div>
                    </details>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                            <h1 className="min-w-0 break-words font-display text-2xl font-semibold sm:text-4xl">{name}</h1>
                            {!editingName && <button ref={nameButton} className={`${button} shrink-0`} aria-label="Edit server name" onClick={() => { setInlineName(name); setEditingName(true); }}><Pencil className="size-4" aria-hidden="true" /></button>}
                        </div>
                        {editingName && <form className="mt-3 flex max-w-xl flex-wrap items-center gap-2" onSubmit={(event) => {
                            event.preventDefault();
                            if (!inlineName.trim()) return;
                            setName(inlineName.trim());
                            setDraftName(inlineName.trim());
                            setSettingsNotice("");
                            setHeaderNotice("Server name saved locally.");
                            finishNameEdit();
                        }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); finishNameEdit(); } }}>
                            <label htmlFor="inline-server-name" className="sr-only">Server name</label>
                            <input id="inline-server-name" autoFocus required maxLength={80} value={inlineName} onChange={(event) => setInlineName(event.target.value)} className={`${input} !w-auto min-w-0 flex-1`} />
                            <button type="button" className={button} onClick={finishNameEdit}>Cancel</button>
                            <button type="submit" disabled={!inlineName.trim()} className={primary}>Save name</button>
                        </form>}
                    </div>

                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-foreground-muted">Server IP:Port</span>
                    <span id="server-address" className="font-mono text-sm" aria-live="polite">{showAddress ? "203.0.113.42:7210" : "Hidden"}</span>
                    <button className={button} aria-controls="server-address" aria-expanded={showAddress} onClick={() => setShowAddress((previous) => !previous)}>{showAddress ? "Hide" : "Show"}<span className="sr-only"> server IP and port</span></button>
                    <button className={button} title="Copy demo IP and port" onClick={async () => {
                        try {
                            await navigator.clipboard.writeText("203.0.113.42:7210");
                            setHeaderNotice("Demo IP and port copied. This fictional server cannot be joined.");
                        } catch {
                            setHeaderNotice("Could not copy. Use Show to reveal the demo IP and port and copy it manually.");
                        }
                    }}><Copy className="size-4" aria-hidden="true" />Copy join address</button>
                </div>
                <Feedback message={headerNotice} onDismiss={() => setHeaderNotice("")} />
            </header>
            <nav aria-label="Server workspace" className="mb-5 grid grid-cols-4 border-b border-white/10 sm:flex sm:gap-1">
                {sections.map(({ name: label, icon: Icon }) => <button key={label} aria-current={section === label ? "page" : undefined} onClick={() => { setSection(label); setConsoleNotice(""); setBackupNotice(""); setSettingsNotice(""); setSaveNotice(""); setConfigNotice(""); }} className={`relative inline-flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-xs leading-4 transition sm:min-h-12 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm focus-visible:outline-2 focus-visible:outline-gold ${section === label ? "border-gold text-gold" : "border-transparent text-foreground-muted hover:text-foreground"}`}>
                    <Icon className="size-4" aria-hidden="true" />{label}{((label === "Save & config" && configDirty) || (label === "Settings" && settingsDirty)) && <span aria-label="Unsaved changes" className="absolute right-2 top-2 size-1.5 rounded-full bg-gold sm:static" />}
                </button>)}
            </nav>

            {section === "Console" && <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Panel title="Console" action={<button className={`${button} !border-transparent !bg-transparent !text-foreground-muted hover:!text-foreground`} onClick={downloadLogs}><Download className="size-4" aria-hidden="true" />Download logs</button>}>
                    <div className="relative">
                        <div ref={logViewport} role="log" aria-label="Demo console output" aria-live="polite" tabIndex={0} onScroll={(event) => {
                            const viewport = event.currentTarget;
                            setFollowingLogs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 24);
                        }} className="h-80 overflow-auto bg-surface-raised p-4 font-mono text-[13px] leading-7 outline-gold sm:h-96 sm:p-5 sm:text-sm">
                            {logs.map((line, i) => {
                                const timestamp = line.match(/^\[\d{2}:\d{2}:\d{2}\] /)?.[0];
                                return <p key={i} className="whitespace-pre-wrap break-words text-foreground"><span className="text-foreground-muted">{timestamp}</span>{line.slice(timestamp?.length ?? 0)}</p>;
                            })}
                        </div>
                        {!followingLogs && <button className={`${button} absolute right-4 bottom-3 !bg-surface-raised shadow-lg`} onClick={() => setFollowingLogs(true)}>Jump to latest <ChevronDown className="size-4" aria-hidden="true" /></button>}
                    </div>
                    <form className="flex gap-2 border-t border-white/10 p-5" onSubmit={(event) => {
                        event.preventDefault();
                        if (!command.trim()) return;
                        setLogs((previous) => [...previous, `> ${command.trim()}`, "[DEMO] Command received locally. Nothing was sent to a server."]);
                        setCommand("");
                    }}>
                        <label className="sr-only" htmlFor="console-command">Console command</label>
                        <input ref={commandInput} id="console-command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Enter a command…" autoComplete="off" className={`${input} min-w-0 font-mono`} />
                        <button type="submit" disabled={!command.trim()} className={primary}>Send <ArrowUpRight className="size-4" aria-hidden="true" /></button>
                    </form>
                    <div className="px-5 pb-5">
                        <p className="text-xs leading-5 text-foreground-muted">Enter to send · Example commands, not verified game syntax.</p>
                        <Feedback message={consoleNotice} />
                    </div>
                </Panel>
                <aside className="min-w-0 rounded-lg border border-white/10 bg-surface" aria-label="Console commands">
                    <div className="hidden border-b border-white/10 p-5 lg:block"><h2 className="text-base font-semibold">Commands</h2><p className="mt-1 text-sm text-foreground-muted">Insert, review, then send.</p></div>
                    <button className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-gold lg:hidden" aria-expanded={commandsOpen} aria-controls="command-picker" onClick={() => setCommandsOpen((previous) => !previous)}>Browse commands <ChevronDown className={`size-4 transition-transform ${commandsOpen ? "rotate-180" : ""}`} aria-hidden="true" /></button>
                    <div id="command-picker" className={`${commandsOpen ? "block" : "hidden"} p-5 lg:block`}>
                        <label htmlFor="command-search" className="sr-only">Search console commands</label>
                        <div className="relative"><Search className="absolute top-3 left-3 size-4 text-foreground-muted" aria-hidden="true" /><input id="command-search" className={`${input} pl-9`} placeholder="Search commands…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                        <div className="mt-4 space-y-4">
                            {[...new Set(matchingCommands.map((item) => item.group))].map((group) => <section key={group}>
                                <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-foreground-muted">{group}</h3>
                                <ul className="divide-y divide-white/10">{matchingCommands.filter((item) => item.group === group).map((item) => <li key={item.command}><button className="group flex w-full items-center justify-between gap-3 rounded px-1 py-3 text-left hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-gold" aria-label={`Insert ${item.command.split(" ")[0]} command`} onClick={() => insertCommand(item.command)}>
                                    <span><code className="block text-sm text-foreground">{item.command.split(" ")[0]}</code><span className="mt-1 block text-[13px] leading-5 text-foreground-muted">{item.description}</span></span>
                                    <ChevronRight className="size-4 shrink-0 text-foreground-muted group-hover:text-gold" aria-hidden="true" />
                                </button></li>)}</ul>
                            </section>)}
                            {!matchingCommands.length && <p className="py-4 text-sm text-foreground-muted">No commands found. Try a different search.</p>}
                        </div>
                    </div>
                </aside>
            </div>}

            {section === "Backups" && <Panel title="Backups" description="Recovery points for your campaign save and config." action={<button className={primary} onClick={() => {
                setBackups((previous) => [{ id: Date.now(), name: "Manual backup", date: "Just now", size: "24.8 MB", kind: "Manual" }, ...previous]);
                setBackupNotice("Backup created locally. No files were copied.");
            }}><Database className="size-4" aria-hidden="true" />Create backup</button>}>
                <div className="border-b border-white/10 px-5 py-4">
                    <p className="text-sm text-foreground-muted">Automatic backups · Daily at 06:00 UTC · Keep 7 days · Sample policy</p>
                    <Feedback message={backupNotice} />
                </div>
                <ul className="divide-y divide-white/10 px-5">{backups.map((backup) => <li key={backup.id} className="py-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div><h3 className="text-sm font-medium">{backup.name}</h3><p className="mt-1 text-xs text-foreground-muted">{backup.date} · {backup.size} · {backup.kind}</p></div>
                        <button className={button} aria-label={`Restore ${backup.name}`} onClick={(event) => { restoreButton.current = event.currentTarget; setBackupNotice(""); setRestoreId(backup.id); }}>Restore…</button>
                    </div>
                    {restoreId === backup.id && <div className={confirmation}>
                        <h4 className="text-sm font-semibold">Restore “{backup.name}”?</h4><p className="mt-2 text-sm leading-6 text-foreground-muted">This would stop the server and replace its save and config. Progress since this backup would be lost. This preview changes nothing.</p>
                        <div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={() => { setRestoreId(null); restoreButton.current?.focus(); }}>Cancel</button><button className={destructive} onClick={() => { setRestoreId(null); setBackupNotice(`Restore previewed for “${backup.name}”. No server or files were changed.`); restoreButton.current?.focus(); }}>Restore backup</button></div>
                    </div>}
                </li>)}</ul>
            </Panel>}

            {section === "Save & config" && <div className="space-y-5">
                <section aria-labelledby="campaign-save-heading" className="rounded-lg border border-white/10 bg-surface p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0">
                            <h2 id="campaign-save-heading" className="text-base font-semibold">Campaign save</h2>
                            <p className="mt-2 break-all font-mono text-sm">{activeSave}</p>
                            <p className="mt-1 text-xs text-foreground-muted">24.8 MB · Saved 2 minutes ago · Sample data</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button className={button} onClick={() => setSaveNotice("Demo export only. No real campaign save is available to download.")}><Download className="size-4" aria-hidden="true" />Export save</button>
                            <button ref={saveImportButton} className={button} onClick={() => saveImport.current?.click()}><Upload className="size-4" aria-hidden="true" />Import save…</button>
                            <input ref={saveImport} id="save-import" type="file" hidden aria-label="Import campaign save" onChange={(event) => {
                                setSaveFile(event.target.files?.[0]?.name ?? "");
                                setSaveNotice("");
                                event.target.value = "";
                            }} />
                        </div>
                    </div>
                    {saveFile && <div className={confirmation}>
                        <h3 className="break-words text-sm font-semibold">Replace the active save with “{saveFile}”?</h3>
                        <p className="mt-2 text-sm leading-6 text-foreground-muted">This would overwrite current campaign progress. In this preview, only the filename changes; nothing is read or uploaded.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button className={button} onClick={() => { setSaveFile(""); saveImportButton.current?.focus(); }}>Cancel</button>
                            <button className={destructive} onClick={() => { setActiveSave(saveFile); setSaveFile(""); setSaveNotice("Save replacement previewed. No campaign data was changed."); saveImportButton.current?.focus(); }}>Replace save</button>
                        </div>
                    </div>}
                    <Feedback message={saveNotice} />
                </section>
                <Panel title="Configuration" description="Changes apply only when you save.">
                    <div className="p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex gap-2" role="group" aria-label="Config editor mode">
                                <button aria-pressed={editor === "json"} className={editor === "json" ? primary : button} onClick={() => setEditor("json")}>JSON{configDirty && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-gold sm:static" aria-label="Unsaved changes" />}</button>
                                <button aria-pressed={editor === "form"} className={editor === "form" ? primary : button} onClick={() => setEditor("form")}>Form preview</button>
                            </div>
                            {editor === "json" && <div className="flex gap-2">
                                <button className={button} onClick={() => configImport.current?.click()}><Upload className="size-4" aria-hidden="true" />Import…</button>
                                <button className={button} onClick={exportConfig}><Download className="size-4" aria-hidden="true" />Export…</button>
                            </div>}
                            <input ref={configImport} id="config-import" type="file" hidden accept=".json,application/json" aria-label="Import JSON config" onChange={async (event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (!file) return;
                                try {
                                    const text = await file.text();
                                    setEditor("json");
                                    if (!validConfig(text)) return;
                                    setConfig(text);
                                    setConfigNotice("Imported into the draft. Review, then save to apply.");
                                } catch { setConfigNotice(""); setConfigError("Could not read this file. Try another JSON file."); }
                            }} />
                        </div>
                        {editor === "json" ? <>
                            <label htmlFor="config-json" className="mb-2 block text-xs text-foreground-muted">config.json</label>
                            <textarea ref={jsonEditor} id="config-json" spellCheck={false} value={config} onChange={(event) => { setConfig(event.target.value); setConfigError(""); setConfigNotice(""); }} aria-invalid={!!configError} aria-describedby={configError ? "config-error config-help" : "config-help"} className={`${input} min-h-64 resize-y font-mono leading-7`} />
                            <p id="config-help" className="mt-3 text-xs leading-5 text-foreground-muted">Preview config · JSON syntax checked on save; game schema validation is not available.</p>
                            {configError && <p id="config-error" role="alert" className="mt-3 text-sm text-red-300">{configError}</p>}
                        </> : <div className="rounded-md border border-white/10 bg-white/[0.02] p-5">
                            <span className="inline-flex rounded bg-white/5 px-2 py-1 text-xs text-foreground-muted">Not interactive yet</span>
                            <p className="mt-3 text-sm leading-6 text-foreground-muted">Form editing will be available when the config schema is supplied.</p>
                            <fieldset disabled className="mt-5 grid gap-5 sm:grid-cols-2">
                                <legend className="sr-only">Illustrative schema fields, not connected to the JSON draft</legend>
                                <label className="text-sm">Maximum players<input type="number" defaultValue={8} className={`${input} mt-2 opacity-50`} /></label>
                                <label className="text-sm">Autosave interval (minutes)<input type="number" defaultValue={15} className={`${input} mt-2 opacity-50`} /></label>
                                <label className="flex items-center gap-2 text-sm"><input type="checkbox" />Friendly fire</label>
                            </fieldset>
                        </div>}
                    </div>
                    {editor === "json" && <SaveBar dirty={configDirty} message={configNotice}>
                        <button className={button} onClick={() => { setConfig(savedConfig); setConfigError(""); setConfigNotice("Changes discarded."); jsonEditor.current?.focus(); }}>Discard</button>
                        <button className={primary} onClick={() => {
                            if (!validConfig(config)) { jsonEditor.current?.focus(); return; }
                            setSavedConfig(config);
                            setConfigNotice("Config saved locally. No server was changed.");
                            jsonEditor.current?.focus({ preventScroll: true });
                        }}>Save config</button>
                    </SaveBar>}
                </Panel>
            </div>}

            {section === "Settings" && <Panel title="Server settings" description="Changes apply only when you save.">
                <form onSubmit={(event) => { event.preventDefault(); if (!draftName.trim()) return; setName(draftName.trim()); setDraftName(draftName.trim()); setVisibility(draftVisibility); setSettingsNotice("Settings saved locally. Nothing was published to the server directory."); settingsName.current?.focus({ preventScroll: true }); }}>
                    <div className="max-w-3xl space-y-5 p-5">
                    <div><label htmlFor="server-name" className="text-sm font-medium">Server name</label><input ref={settingsName} id="server-name" required maxLength={80} value={draftName} onChange={(event) => { setDraftName(event.target.value); setSettingsNotice(""); }} className={`${input} mt-2`} /><p className="mt-2 text-xs leading-5 text-foreground-muted">The name players see in the server browser.</p></div>
                    <fieldset><legend className="text-sm font-medium">Directory visibility</legend><p className="mt-2 text-sm leading-6 text-foreground-muted">Controls whether the server appears in the public browser. Visibility does not grant console or management access, and is not a join password.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {[{ value: "private", title: "Private", description: "Hidden from the public server browser.", icon: LockKeyhole }, { value: "public", title: "Public", description: "Listed in the public server browser.", icon: Globe2 }].map(({ value, title, description, icon: Icon }) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${draftVisibility === value ? "border-gold/50 bg-gold/5" : "border-white/10"}`}><input type="radio" name="visibility" value={value} checked={draftVisibility === value} onChange={() => { setDraftVisibility(value); setSettingsNotice(""); }} className="mt-1 accent-gold" /><span><span className="flex items-center gap-2 text-sm font-medium"><Icon className={`size-4 ${draftVisibility === value ? "text-gold" : "text-foreground-muted"}`} aria-hidden="true" />{title}</span><span className="mt-2 block text-xs leading-5 text-foreground-muted">{description}</span></span></label>)}
                    </div></fieldset>
                    </div>
                    <SaveBar dirty={settingsDirty} message={settingsNotice}>
                        <button type="button" className={button} onClick={() => { setDraftName(name); setDraftVisibility(visibility); setSettingsNotice("Changes discarded."); settingsName.current?.focus(); }}>Discard</button>
                        <button type="submit" disabled={!draftName.trim()} className={primary}>Save settings</button>
                    </SaveBar>
                </form>
            </Panel>}
        </div>
    </main>;
}
