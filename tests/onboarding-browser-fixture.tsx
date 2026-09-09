// MOCK-ONLY browser harness. Copied into an ignored disposable Next snapshot by
// onboarding-browser.mjs. This is never an application route or auth bypass.
"use client";
import { useEffect, useState } from "react";
import { ServerOnboarding } from "@/app/components/servers/ServerOnboarding";
import { onboardingSummary, onboardingCreated, onboardingRequested, ONBOARDING_TEST_ID } from "./onboarding-fixtures";
import { ServerDirectoryTable } from "@/app/components/servers/ServerDirectoryTable";

export default function BrowserFixture() {
    const [revision, setRevision] = useState(0);
    const [mounted, setMounted] = useState(false);
    const [mode, setMode] = useState("eligible");
    const [userId, setUserId] = useState("account-a");
    useEffect(() => {
        const update = () => setRevision((value) => value + 1);
        window.addEventListener("fixture-update", update);
        const timer = setTimeout(() => { setMounted(true); update(); }, 0);
        return () => { clearTimeout(timer); window.removeEventListener("fixture-update", update); };
    }, []);
    const summary = onboardingSummary();
    const created = mounted && sessionStorage.getItem("fixture-created") === "yes";
    const requested = mounted && sessionStorage.getItem("fixture-requested") === "yes";
    if (created || mode === "consumed") summary.eligibility = { eligible: false, reason: "quota_exhausted", granted: 1, used: 1, remaining: 0 };
    if (requested) summary.regions[2].request = onboardingRequested().request;
    // Preserve a stable snapshot until a deliberate fixture refresh; production uses RSC refresh.
    const [snapshot, setSnapshot] = useState(summary);
    useEffect(() => { const timeout = setTimeout(() => setSnapshot(summary), 0); return () => clearTimeout(timeout); }, [revision, mode]); // eslint-disable-line react-hooks/exhaustive-deps
    return <main className="min-h-svh bg-background"><div className="site-container py-8 sm:py-12">
        <header className="border border-gold/40 bg-surface p-4 text-gold"><strong>MOCK-ONLY · Browser integration fixture</strong><p>No real authentication, backend, Supabase, capacity or server creation.</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">{["eligible", "consumed", "unavailable"].map((value) => <button key={value} onClick={() => setMode(value)}>{value}</button>)}
                <button onClick={() => { sessionStorage.clear(); setMode("eligible"); setUserId("account-a"); setRevision((v) => v + 1); }}>Reset mock</button>
                <button onClick={() => setUserId(userId === "account-a" ? "account-b" : "account-a")}>Switch page account</button>
            </div>
        </header>
        <p className="mt-8 font-label text-xs uppercase tracking-widest text-gold">Campaign directory</p><h1 className="mt-2 font-display text-5xl">Servers</h1>
        <ServerOnboarding userId={userId} summary={mode === "unavailable" ? null : snapshot} />
        <section className="mt-10"><h2 className="mb-5 font-display text-3xl">My Servers · mock inventory</h2><ServerDirectoryTable servers={created ? [{ id: ONBOARDING_TEST_ID, name: onboardingCreated().displayName, status: "Offline", connectionType: "Direct", joinUrl: "bannerlordcoop://join/mock-only", players: null, manageUrl: `/servers/${ONBOARDING_TEST_ID}` }] : []} emptyMessage="No mock servers yet." /></section>
        <section className="mt-12"><h2 className="font-display text-3xl">All Servers</h2><p className="mt-3 text-foreground-muted">Mock-only screenshot; the production public directory and real mixed inventory are tested separately.</p></section>
    </div></main>;
}
