"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Database, FileJson, Settings2, Terminal } from "lucide-react";

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
        <aside className="rounded-lg border border-white/10 bg-surface p-5" aria-label="Console commands">
            <h2 className="text-base font-semibold">Commands</h2>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">The command picker is not connected yet. Use the console input to send known server commands.</p>
            <button disabled className={`${button} mt-4`}>Browse commands</button>
        </aside>
    </div>;
}

export function UnavailableServerPanel({ title, actions }: { title: string; actions: string[] }) {
    return <section className="rounded-lg border border-white/10 bg-surface p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-foreground-muted">Not connected yet. These features are unavailable for this server.</p>
        <div className="mt-4 flex flex-wrap gap-2">{actions.map(action => <button key={action} disabled className={button}>{action}</button>)}</div>
    </section>;
}

export function ServerManagementWorkspace({ name, address, summary, status, visibility, notice, initialSection = "Console", children }: {
    name: ReactNode; address?: string | null; summary: ReactNode; status?: ReactNode; visibility?: ReactNode; notice: string;
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
            <p className="my-5 rounded-md border border-white/10 bg-surface px-4 py-3 text-sm leading-6 text-foreground-muted">{notice}</p>
            <header className="mb-5">
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
