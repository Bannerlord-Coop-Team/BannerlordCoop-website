"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, Copy, Database, FileJson, Play, RotateCw, Search, Settings2, Square, Terminal } from "lucide-react";

import { DownloadServerLogButton } from "./DownloadServerLogButton";

const sections = [
    { name: "Console", icon: Terminal },
    { name: "Backups", icon: Database },
    { name: "Save & config", icon: FileJson },
    { name: "Settings", icon: Settings2 },
] as const;
type Section = typeof sections[number]["name"];
const WorkspaceContext = createContext<Section>("Console");
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-foreground hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";

export function ServerWorkspacePanel({ section, children }: { section: Section; children: ReactNode }) {
    const current = useContext(WorkspaceContext);
    // Preserve console connections, pending operations and transfer drafts across tabs.
    return <div hidden={current !== section} className="space-y-5">{children}</div>;
}

export function ServerConsoleWorkspace({ children }: { children: ReactNode }) {
    return <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">{children}</div>
        <aside className="min-w-0 rounded-lg border border-white/10 bg-surface" aria-label="Console commands">
            <div className="hidden border-b border-white/10 p-5 lg:block"><h2 className="text-base font-semibold">Commands</h2><p className="mt-1 text-sm text-foreground-muted">Insert, review, then send.</p></div>
            <button disabled className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 lg:hidden">Browse commands <ChevronDown className="size-4" aria-hidden="true" /></button>
            <div className="hidden p-5 lg:block">
                <label htmlFor="command-search" className="sr-only">Search console commands</label>
                <div className="relative"><Search className="absolute top-3 left-3 size-4 text-foreground-muted" aria-hidden="true" /><input id="command-search" disabled className="w-full rounded-md border border-white/15 bg-background py-2.5 pr-3 pl-9 text-sm disabled:cursor-not-allowed disabled:opacity-40" placeholder="Search commands…" /></div>
                <p className="mt-3 text-xs leading-5 text-foreground-muted">Example commands only. The command picker is not connected yet.</p>
                <div className="mt-4 space-y-4">
                    {[{ group: "Information", commands: [["help", "List available console commands"], ["players", "Show connected players"]] }, { group: "Campaign", commands: [["save", "Save the current campaign"]] }, { group: "Players", commands: [["announce", "Send a message to all players"]] }].map(({ group, commands }) => <section key={group}>
                        <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-foreground-muted">{group}</h3>
                        <ul className="divide-y divide-white/10">{commands.map(([command, description]) => <li key={command}><button disabled className="flex w-full items-center justify-between gap-3 rounded px-1 py-3 text-left disabled:cursor-not-allowed disabled:opacity-40"><span><code className="block text-sm text-foreground">{command}</code><span className="mt-1 block text-[13px] leading-5 text-foreground-muted">{description}</span></span><ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" /></button></li>)}</ul>
                    </section>)}
                </div>
            </div>
        </aside>
    </div>;
}

export function UnavailableServerConsole({ controls, logDownload }: { controls?: ReactNode; logDownload?: { serverId: string; userId: string } }) {
    return <section className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <h2 className="text-base font-semibold">Console</h2>
            <DownloadServerLogButton {...logDownload} className={`${button} !border-transparent !bg-transparent !text-foreground-muted`} />
        </div>
        <div className="border-b border-white/10 px-5 py-3">{controls ?? <div role="group" aria-label="Server controls" className="grid grid-cols-3 gap-2 sm:flex">{[{ label: "Start", icon: Play }, { label: "Stop", icon: Square }, { label: "Restart", icon: RotateCw }].map(({ label, icon: Icon }) => <button key={label} disabled className={`${button} !gap-1 !px-2 !text-xs sm:!gap-2 sm:!px-3 sm:!text-sm`}><Icon className="size-3.5 shrink-0 sm:size-4" aria-hidden="true" />{label}</button>)}</div>}</div>
        <div role="log" aria-label="Console output" tabIndex={0} className="h-80 overflow-auto bg-surface-raised p-4 font-mono text-[13px] leading-7 text-foreground-muted outline-gold sm:h-96 sm:p-5 sm:text-sm">Console output is not connected for this server.</div>
        <div className="flex gap-2 border-t border-white/10 p-5">
            <label className="sr-only" htmlFor="console-command">Console command</label>
            <input id="console-command" disabled placeholder="Enter a command…" className="w-full min-w-0 rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-40" />
            <button disabled className={`${button} !border-gold/50 !bg-gold/15 !text-gold`}>Send <ArrowUpRight className="size-4" aria-hidden="true" /></button>
        </div>
        <p className="px-5 pb-5 text-xs leading-5 text-foreground-muted">Console input is unavailable until a live console is connected.</p>
    </section>;
}

export function UnavailableServerPanel({ title, actions }: { title: string; actions: string[] }) {
    return <section className="rounded-lg border border-white/10 bg-surface p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-foreground-muted">Not connected yet. These features are unavailable for this server.</p>
        <div className="mt-4 flex flex-wrap gap-2">{actions.map(action => <button key={action} disabled className={button}>{action}</button>)}</div>
    </section>;
}

export function ServerManagementWorkspace({ name, address, summary, status, visibility, notice, initialSection = "Console", children }: {
    name: ReactNode; address?: string | null; summary: ReactNode; status?: ReactNode; visibility?: ReactNode; notice?: string;
    initialSection?: Section; children: ReactNode;
}) {
    const [section, setSection] = useState<Section>(initialSection);
    const [showAddress, setShowAddress] = useState(false);
    const [feedback, setFeedback] = useState("");
    useEffect(() => {
        function followHash() {
            const target = window.location.hash;
            if (target === "#server-access") setSection("Settings");
            if (target === "#server-backups") setSection("Backups");
            if (target === "#server-files") setSection("Save & config");
            if (target === "#server-lifecycle") setSection("Console");
        }
        followHash();
        window.addEventListener("hashchange", followHash);
        return () => window.removeEventListener("hashchange", followHash);
    }, []);

    return <WorkspaceContext.Provider value={section}><main className="min-h-svh bg-background">
        <div className="site-container py-6 sm:py-10">
            <Link href="/servers" className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-gold"><ArrowLeft className="size-4" aria-hidden="true" />All servers</Link>
            {notice && <p className="my-5 rounded-md border border-white/10 bg-surface px-4 py-3 text-sm leading-6 text-foreground-muted">{notice}</p>}
            <header className="mt-5 mb-5">
                <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-foreground-muted">{summary}{visibility}</div>
                {name}
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-foreground-muted">Server IP:Port</span>
                    <span id="server-address" className="font-mono" aria-live="polite">{address ? (showAddress ? address : "Hidden") : "Not assigned"}</span>
                    <button disabled={!address} className={button} aria-controls="server-address" aria-expanded={showAddress} onClick={() => setShowAddress(!showAddress)}>{showAddress ? "Hide" : "Show"}<span className="sr-only"> server IP and port</span></button>
                    <button disabled={!address} className={button} onClick={async () => {
                        if (!address) return;
                        try { await navigator.clipboard.writeText(address); setFeedback("Join address copied."); }
                        catch { setFeedback("Could not copy. Show the address to copy it manually."); }
                    }}><Copy className="size-4" aria-hidden="true" />Copy join address</button>
                </div>
                <p role="status" className="mt-2 text-sm text-foreground-muted">{feedback}</p>
                {status && <div className="mt-5">{status}</div>}
            </header>
            <nav aria-label="Server workspace" className="mb-5 grid grid-cols-4 border-b border-white/10 sm:flex sm:gap-1">
                {sections.map(({ name: label, icon: Icon }) => <button key={label} aria-current={section === label ? "page" : undefined} onClick={() => setSection(label)} className={`inline-flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-xs sm:min-h-12 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm focus-visible:outline-2 focus-visible:outline-gold ${section === label ? "border-gold text-gold" : "border-transparent text-foreground-muted hover:text-foreground"}`}><Icon className="size-4" aria-hidden="true" />{label}</button>)}
            </nav>
            <div className="space-y-5">{children}</div>
        </div>
    </main></WorkspaceContext.Provider>;
}
