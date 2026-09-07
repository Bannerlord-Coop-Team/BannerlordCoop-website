"use client";

import { ArrowRight, Server, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { submitServerOnboarding } from "@/app/servers/onboarding-actions";
import { clearOnboardingIntent, onboardingIntentKey, readOnboardingIntent, storeOnboardingIntent } from "@/app/servers/onboarding-intent";
import { normalizeOnboardingName, ONBOARDING_REGION_LABELS, type OnboardingIntent, type OnboardingRegion, type OnboardingResult, type OnboardingSummary } from "../../../../supabase/functions/_shared/server-onboarding-contract";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
const primaryButton = `inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-gold px-5 py-3 font-label text-sm font-semibold uppercase tracking-[0.1em] text-background transition-colors hover:bg-[#c3b07b] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
const secondaryButton = `inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-white/15 px-4 py-2 text-sm text-foreground-muted hover:border-gold/50 hover:text-foreground disabled:opacity-60 ${focusRing}`;
const labelStyle = "font-label text-xs font-semibold uppercase tracking-[0.16em] text-gold";

type Props = { userId: string; summary: OnboardingSummary | null };
export function ServerOnboarding(props: Props) {
    return <OnboardingSession key={props.userId} {...props} />;
}
function OnboardingSession({ userId, summary }: Props) {
    const router = useRouter();
    const key = onboardingIntentKey(userId);
    const [ready, setReady] = useState(false);
    const [storageError, setStorageError] = useState(false);
    const [intent, setIntent] = useState<OnboardingIntent | null>(null);
    const intentRef = useRef<OnboardingIntent | null>(null);
    const inFlight = useRef(false);
    const completionAuthority = useRef<object | null>(null);
    const [pending, setPending] = useState(false);
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [result, setResult] = useState<OnboardingResult | null>(null);
    const [staleSnapshot, setStaleSnapshot] = useState<OnboardingSummary | null>(null);
    const fallbackRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // Each effect lifetime owns its completions, including StrictMode's repeated setup.
        completionAuthority.current = {};
        const timer = window.setTimeout(() => {
            try {
                const retained = readOnboardingIntent(window.sessionStorage, key);
                intentRef.current = retained;
                setIntent(retained);
                setReady(true);
            } catch { setStorageError(true); }
        }, 0);
        return () => {
            completionAuthority.current = null;
            window.clearTimeout(timer);
        };
    }, [key]);

    const canOffer = summary !== null && summary !== staleSnapshot && summary.eligibility.eligible && summary.unavailableReason === null;
    const busy = !ready || storageError || pending;
    async function dispatch(candidate: OnboardingIntent) {
        const authority = completionAuthority.current;
        if (!authority || inFlight.current || !ready || storageError) return;
        inFlight.current = true;
        try {
            // Write before any dispatch; retries ignore current eligibility/capacity/list state.
            storeOnboardingIntent(window.sessionStorage, key, candidate);
            intentRef.current = candidate;
            setIntent(candidate);
        } catch {
            setStorageError(true);
            inFlight.current = false;
            return;
        }
        setPending(true);
        setMessage("");
        try {
            const response = await submitServerOnboarding(candidate, userId);
            // Unmounted sessions leave even identical retained intents for the new session to replay.
            if (completionAuthority.current !== authority) return;
            if (response.ok || !response.retrySameRequest) {
                try { clearOnboardingIntent(window.sessionStorage, key, candidate); }
                catch { setStorageError(true); }
                intentRef.current = null;
                setIntent(null);
                setStaleSnapshot(summary);
                router.refresh();
            }
            if (response.ok) setResult(response.result);
            else setMessage(response.message);
        } catch {
            if (completionAuthority.current === authority) {
                setMessage("The submission outcome is unconfirmed. Retry the same pending request; closing this dialog does not cancel it.");
            }
        } finally {
            if (completionAuthority.current === authority) {
                inFlight.current = false;
                setPending(false);
            }
        }
    }
    function createCandidate(displayName: string, region: OnboardingRegion, available: boolean) {
        if (!canOffer || busy || intentRef.current !== null || inFlight.current) return;
        const entry = summary?.regions.find((entry) => entry.region === region);
        if (!entry || entry.available !== available || (!available && entry.request !== null)) return;
        try {
            const requestId = crypto.randomUUID();
            void dispatch(available ? { action: "create-server", displayName, region, requestId } : { action: "request-region", region, requestId });
        } catch { setStorageError(true); }
    }
    const recovery = <>
        {storageError && <p role="alert" className="mt-4 text-sm text-red-200">Safe request storage is unavailable or invalid. Setup is blocked. Keep this tab&apos;s data; restore session storage and refresh before retrying.</p>}
        {intent && <div className="mt-4 border border-gold/30 bg-surface p-4 text-sm">
            <p>A pending {intent.action === "create-server" ? `server creation (${intent.displayName})` : "region request"} in {ONBOARDING_REGION_LABELS[intent.region]} needs confirmation.</p>
            <p className="mt-2 text-foreground-muted">Closing or refreshing does not cancel a submitted request. Retry uses the exact saved request, even if your quota or capacity changed.</p>
            <button type="button" disabled={busy} onClick={() => { if (intentRef.current) void dispatch(intentRef.current); }} className={`${secondaryButton} mt-3`}>{pending ? "Confirming request…" : "Retry pending request"}</button>
        </div>}
        {message && <p role="status" className="mt-4 text-sm text-gold">{message}</p>}
    </>;
    return <div ref={fallbackRef} tabIndex={-1} className="outline-none">
        {canOffer ? <section aria-labelledby="available-server-heading" className="relative mt-7 overflow-hidden rounded-sm border border-gold/40 bg-[radial-gradient(ellipse_at_top_right,rgba(170,151,96,0.18),transparent_65%)] p-5 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-4 sm:gap-5">
                    <div className="hidden size-14 shrink-0 items-center justify-center rounded-sm border border-gold/30 bg-gold/10 sm:flex"><Server aria-hidden="true" className="size-7 text-gold" strokeWidth={1.4} /></div>
                    <div><p className={labelStyle}>Your granted server quota</p>
                        <h2 id="available-server-heading" className="mt-2 font-display text-3xl font-semibold sm:text-4xl">You have a server available</h2>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-foreground-muted">Give your campaign a name and choose where it lives. Setup uses one unused explicitly granted server slot.</p>
                        <p className="mt-4 flex items-center gap-2 text-xs text-gold"><ShieldCheck aria-hidden="true" className="size-4" />{summary.eligibility.remaining} unused · regional capacity checked at submission</p>
                    </div>
                </div>
                <button type="button" disabled={busy || intent !== null} onClick={() => { setResult(null); setMessage(""); setOpen(true); }} className={`${primaryButton} shrink-0`}>Set up server <ArrowRight aria-hidden="true" className="size-4" /></button>
            </div>
        </section> : <div role="status" className="mt-7 border border-white/10 bg-surface px-5 py-4 text-sm text-foreground-muted">
            {summary === null || summary.unavailableReason !== null || summary === staleSnapshot
                ? "Server setup availability could not be confirmed or is temporarily unavailable. Refresh to check again."
                : summary.eligibility.reason === "quota_exhausted" ? "Your explicitly granted server quota is currently in use." : "No unused explicitly granted server quota is available for this account."}
        </div>}
        <button type="button" className={`${secondaryButton} mt-3`} onClick={() => router.refresh()}>Refresh availability and My Servers</button>
        {!open && recovery}
        {!open && result && <div className="mt-5 border border-gold/30 bg-surface p-5"><OnboardingReceipt result={result} /></div>}
        {summary?.regions.some((entry) => entry.request !== null) && <section aria-label="Your outstanding region requests" className="mt-5 border border-white/10 bg-surface p-5 text-sm">
            <h3 className="font-semibold">Your outstanding region requests</h3>
            <ul className="mt-2 space-y-1">{summary.regions.filter((entry) => entry.request !== null).map((entry) => <li key={entry.region}>{entry.label} — request saved (outstanding)</li>)}</ul>
            <p className="mt-3 text-foreground-muted">Private requests do not consume quota or reserve a server. No email, ETA or automatic capacity is promised. Requests remain outstanding if capacity arrives or you create a server.</p>
        </section>}
        {open && <SetupDialog summary={summary} canOffer={canOffer} disabled={busy || intent !== null} pending={pending} result={result} recovery={recovery}
            onSubmit={createCandidate} onDismiss={() => setOpen(false)} onRefresh={() => router.refresh()} fallbackFocus={() => fallbackRef.current?.focus()} />}
    </div>;
}

export function GamePasswordNotice() {
    return <p className="mt-4 text-sm leading-6 text-foreground-muted">Manage your game password through the existing Discord owner controls: <strong className="text-foreground">My Servers → choose server → Settings / Configure your server → Custom game password (optional)</strong>. Enter a new custom password and submit. Leaving it blank preserves the generated password, which is not available on this website. Discord does not mask this input or echo the submitted password.</p>;
}
function OnboardingReceipt({ result }: { result: OnboardingResult }) {
    return <div role="status">
        <h3 className="font-display text-2xl font-semibold">{result.action === "create-server" ? "Server assigned" : "Region request confirmed"}</h3>
        {result.action === "create-server" ? <>
            <p className="mt-3 break-words text-sm leading-6">{result.displayName} was assigned in {ONBOARDING_REGION_LABELS[result.region]}. It was stopped at creation; this receipt is not live status. Check My Servers or manage the server for its current state.</p>
            <p className="mt-3 text-sm text-foreground-muted">Stable release · maintenance 03:00–04:00 America/Chicago. Setup does not start the server. Its first Start uses the bundled default save; no import is required.</p>
            <GamePasswordNotice />
            <Link href={`/servers/${encodeURIComponent(result.serverId)}`} className={`${primaryButton} mt-5`}>Manage server <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </> : <p className="mt-3 text-sm leading-6">Your private request for {ONBOARDING_REGION_LABELS[result.request.region]} is saved and outstanding (including an existing request). No server or capacity was reserved and no quota was consumed. No email, ETA or automatic allocation is promised.</p>}
    </div>;
}
function SetupDialog({ summary, canOffer, disabled, pending, result, recovery, onSubmit, onDismiss, onRefresh, fallbackFocus }: {
    summary: OnboardingSummary | null; canOffer: boolean; disabled: boolean; pending: boolean; result: OnboardingResult | null; recovery: ReactNode;
    onSubmit: (name: string, region: OnboardingRegion, available: boolean) => void; onDismiss: () => void; onRefresh: () => void; fallbackFocus: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const resultRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const fallback = useRef(fallbackFocus);
    const [name, setName] = useState("");
    const [selected, setSelected] = useState<OnboardingRegion>("us-west");
    const [error, setError] = useState("");
    const entry = summary?.regions.find((entry) => entry.region === selected);
    useEffect(() => {
        const dialog = dialogRef.current!;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const restoreFallback = fallback.current;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialog.showModal();
        nameRef.current?.focus();
        return () => {
            dialog.close();
            document.body.style.overflow = previousOverflow;
            const canRestore = previousFocus?.isConnected && !previousFocus.matches(":disabled");
            if (canRestore) previousFocus.focus();
            if (!canRestore || document.activeElement !== previousFocus) restoreFallback();
        };
    }, []);
    useEffect(() => {
        if (result) resultRef.current?.focus();
        else if (pending) closeRef.current?.focus();
    }, [result, pending]);
    function submit(event: FormEvent) {
        event.preventDefault();
        if (!canOffer || disabled || !entry || (!entry.available && entry.request !== null)) return;
        const normalized = normalizeOnboardingName(name);
        if (entry.available && normalized === null) {
            setError("Use 3–48 characters: letters or numbers at both ends; letters, numbers, spaces, periods, apostrophes and hyphens inside.");
            nameRef.current?.focus();
            return;
        }
        setError("");
        if (normalized !== null) setName(normalized);
        onSubmit(normalized ?? "", entry.region, entry.available);
    }
    return <dialog ref={dialogRef} aria-labelledby="server-setup-title" aria-describedby="server-setup-description"
        onCancel={(event) => { event.preventDefault(); onDismiss(); }}
        onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter((element) => !element.matches(":disabled"));
            const first = controls[0]; const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-sm border border-gold/35 bg-surface-raised p-0 text-foreground shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm">
        <div className="border-t-2 border-gold p-5 sm:p-8">
            <div className="flex items-start justify-between gap-3"><div><p className={labelStyle}>Your next campaign</p><h2 id="server-setup-title" className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Set up your server</h2></div>
                <button ref={closeRef} type="button" aria-label="Close server setup" onClick={onDismiss} className={`${secondaryButton} size-11 shrink-0 px-0`}><X aria-hidden="true" className="size-5" /></button></div>
            <p id="server-setup-description" className="mt-3 text-sm leading-6 text-foreground-muted">Create assigns a real stopped server using one granted slot. Full regions can be privately requested without consuming quota.</p>
            {result ? <div ref={resultRef} tabIndex={-1} className="mt-6 outline-none"><OnboardingReceipt result={result} /><button type="button" onClick={onDismiss} className={`${secondaryButton} mt-5`}>Done</button></div> : <form noValidate onSubmit={submit} className="mt-6">
                <fieldset disabled={disabled || !canOffer}>
                    <legend className="sr-only">Server details</legend>
                    <label htmlFor="onboarding-server-name" className="text-sm font-medium">Server name{entry && !entry.available ? " (not sent for region requests)" : ""}</label>
                    <input ref={nameRef} id="onboarding-server-name" value={name} onChange={(event) => { setName(event.target.value); setError(""); }} autoComplete="off" placeholder="e.g. The Calradia Company" aria-invalid={!!error} aria-describedby={`onboarding-name-hint${error ? " onboarding-name-error" : ""}`} className={`mt-2 block min-h-12 w-full rounded-sm border border-white/20 bg-background px-3 py-2 text-base ${focusRing}`} />
                    <p id="onboarding-name-hint" className="mt-2 text-xs leading-5 text-foreground-muted">3–48 characters. Letters or numbers at both ends. Spaces and supported punctuation inside. Whitespace is normalized.</p>
                    {error && <p id="onboarding-name-error" role="alert" className="mt-2 text-sm text-red-200">{error}</p>}
                    <fieldset className="mt-6"><legend className="text-sm font-medium">Server region</legend>
                        <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:grid-cols-3">{summary?.regions.map((region) => <label key={region.region} className={`relative flex cursor-pointer items-start gap-2 rounded-sm border p-3 transition-colors hover:border-gold/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold ${selected === region.region ? "border-gold bg-gold/10" : "border-white/15 bg-surface"}`}>
                            <input type="radio" name="region" value={region.region} checked={selected === region.region} onChange={() => setSelected(region.region)} className="mt-1 size-3.5 shrink-0 accent-gold" />
                            <span className="min-w-0"><span className="block text-sm font-medium">{region.label}</span><span className={`mt-2 block text-xs ${region.available ? "text-emerald-200" : "text-amber-200"}`}>{region.available ? "Available" : "Full"}{region.request ? " · Requested" : ""}</span></span>
                        </label>)}</div>
                    </fieldset>
                </fieldset>
                {!canOffer && <p role="status" className="mt-4 text-sm text-gold">Availability changed or could not be confirmed. Refresh before choosing again.</p>}
                {entry && !entry.available && <p className="mt-4 text-sm text-foreground-muted">{entry.request ? "Your request for this region is already saved and outstanding." : "Request this full region, or choose an available one. A request does not reserve capacity, consume quota or promise email, an ETA or automatic allocation."}</p>}
                <p role="status" className="mt-4 text-sm text-gold">{pending ? "Submitting… Closing does not cancel this request." : "Capacity is advisory until the backend accepts the request."}</p>
                {recovery}
                <div className="mt-5 flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:flex-wrap sm:justify-end">
                    <button type="button" onClick={onDismiss} className={secondaryButton}>{pending ? "Close (request continues)" : "Close"}</button>
                    <button type="button" onClick={onRefresh} className={secondaryButton}>Refresh availability</button>
                    <button type="submit" disabled={disabled || !canOffer || !entry || (!entry.available && entry.request !== null)} className={primaryButton}>{pending ? "Submitting…" : entry?.available ? "Create server" : entry?.request ? "Region already requested" : "Request region"}</button>
                </div>
            </form>}
        </div>
    </dialog>;
}
