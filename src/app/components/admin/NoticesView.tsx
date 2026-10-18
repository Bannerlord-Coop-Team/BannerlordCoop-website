"use client";

import { LoaderCircle, Megaphone, Search, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Empty } from "@/app/components/admin/ControlPlanePresentation";
import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { operationExplanation } from "@/app/lib/control-plane/explanations";
import {
    NOTICE_LIMITS,
    noticeErrorMessage,
    noticeInput,
    noticeKindLabel,
    noticeRequestId,
    noticeTargetSummary,
    type NoticeForm,
} from "@/app/lib/control-plane/notices";
import type { HostingAdminNotice, HostingAdminNoticeCreation, HostingPage, ManagedServer, NoticesViewData } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";

const buttonClass = "inline-flex min-h-9 items-center gap-1.5 border px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-40";
const inputClass = "mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground outline-none placeholder:text-foreground-dim focus:border-gold disabled:opacity-60";
const labelClass = "font-label text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-foreground-muted";
const badgeClass = "inline-flex w-fit border px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em]";
const NOTICE_PAGE_LIMIT = 25;
const NOTICE_STATE_LABELS: Record<HostingAdminNotice["state"], string> = { active: "Active", expired: "Expired", withdrawn: "Withdrawn" };
const NOTICE_STATE_BADGES: Record<HostingAdminNotice["state"], string> = {
    active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    expired: "border-white/15 text-foreground-muted",
    withdrawn: "border-crimson/30 bg-crimson/10 text-red-200",
};
const EMPTY_FORM: NoticeForm = { title: "", body: "", severity: "info", expiresAt: "", reason: "" };

async function accessToken() {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session?.access_token) throw new Error("Authentication is required.");
    return session.access_token;
}

/** Writes server notices for selected servers and lists earlier ones with their reach. */
export function NoticesView({ data }: { data: NoticesViewData }) {
    const [revision, setRevision] = useState(0);
    return (
        <section className="mt-8 space-y-8">
            <CreateNotice initialServers={data.servers} onCreated={() => setRevision((value) => value + 1)} />
            <NoticeList revision={revision} />
        </section>
    );
}

function CreateNotice({ initialServers, onCreated }: { initialServers: HostingPage<ManagedServer>; onCreated: () => void }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<{ query: string; page: HostingPage<ManagedServer> }>({ query: "", page: initialServers });
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState("");
    const [selected, setSelected] = useState<ReadonlyMap<string, string>>(new Map());
    const [form, setForm] = useState<NoticeForm>(EMPTY_FORM);
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
    // Kept across failed or uncertain submissions so an unchanged retry replays the same notice.
    const [lastRequest, setLastRequest] = useState<{ fingerprint: string; requestId: string } | null>(null);

    async function search(cursor: string | null) {
        if (searching) return;
        const term = cursor === null ? query.trim() : results.query;
        setSearching(true);
        setSearchError("");
        try {
            const page = await requestControlPlaneAdmin<HostingPage<ManagedServer>>({
                accessToken: await accessToken(),
                requestId: crypto.randomUUID(),
                operation: "servers",
                input: { filter: term ? { query: term } : {}, cursor, limit: 100 },
            });
            setResults((current) => cursor === null ? { query: term, page } : {
                query: term,
                page: { items: [...current.page.items, ...page.items.filter((item) => !current.page.items.some((existing) => existing.serverId === item.serverId))], nextCursor: page.nextCursor },
            });
        } catch (cause) {
            setSearchError(cause instanceof Error ? cause.message : "Servers could not be searched.");
        } finally {
            setSearching(false);
        }
    }

    function toggle(server: ManagedServer, checked: boolean) {
        setSelected((current) => {
            const next = new Map(current);
            if (checked && next.size < NOTICE_LIMITS.targets) next.set(server.serverId, server.displayName);
            else if (!checked) next.delete(server.serverId);
            return next;
        });
    }

    function selectShown() {
        setSelected((current) => {
            const next = new Map(current);
            for (const server of results.page.items) {
                if (next.size >= NOTICE_LIMITS.targets) break;
                next.set(server.serverId, server.displayName);
            }
            return next;
        });
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending) return;
        const parsed = noticeInput(form, [...selected.keys()]);
        if ("error" in parsed) {
            setResult({ ok: false, message: parsed.error });
            return;
        }
        const count = parsed.input.serverIds.length;
        if (!window.confirm(`Show “${parsed.input.title}” at the top of ${count} ${count === 1 ? "server's page" : "servers' pages"}? Everyone who can view ${count === 1 ? "that server" : "those servers"} sees it until they dismiss it.`)) return;
        const request = noticeRequestId(parsed.input, lastRequest);
        setLastRequest(request);
        setPending(true);
        setResult(null);
        try {
            const created = await requestControlPlaneAdmin<HostingAdminNoticeCreation>({
                accessToken: await accessToken(),
                requestId: request.requestId,
                operation: "create-notice",
                input: parsed.input,
            });
            setResult({ ok: true, message: created?.outcome === "existing"
                ? "That notice had already been created; the earlier request went through."
                : `Notice created for ${count} ${count === 1 ? "server" : "servers"}.` });
            setLastRequest(null);
            setForm(EMPTY_FORM);
            setSelected(new Map());
            onCreated();
        } catch (cause) {
            setResult({ ok: false, message: noticeErrorMessage(cause, "The notice could not be created.") });
        } finally {
            setPending(false);
        }
    }

    function searchOnEnter(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        void search(null);
    }

    const full = selected.size >= NOTICE_LIMITS.targets;
    return (
        <form onSubmit={(event) => void submit(event)} className="border border-white/10 bg-surface p-5" aria-labelledby="create-notice-heading">
            <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">Server pages</p>
            <h2 id="create-notice-heading" className="mt-1 font-display text-3xl font-semibold text-foreground">New notice</h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-foreground-muted">{operationExplanation("create-notice")}</p>
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
                <fieldset className="min-w-0">
                    <legend className={labelClass}>Servers</legend>
                    <div className="mt-1.5 flex gap-2">
                        <label className="sr-only" htmlFor="notice-server-search">Search servers</label>
                        <input id="notice-server-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={searchOnEnter} maxLength={100}
                            placeholder="Name, owner, server, VPS…" className={`${inputClass} mt-0 flex-1`} />
                        <button type="button" disabled={searching} onClick={() => void search(null)} className={`${buttonClass} border-gold/40 text-gold hover:bg-gold/10`}>
                            {searching ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Search aria-hidden="true" className="size-3.5" />} Search
                        </button>
                    </div>
                    {searchError && <p role="alert" className="mt-2 text-xs text-red-200">{searchError}</p>}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-muted">
                        <span>{results.page.items.length} {results.query ? `matching “${results.query}”` : "shown"}</span>
                        <span className="flex gap-2">
                            <button type="button" disabled={full || results.page.items.length === 0} onClick={selectShown} className={`${buttonClass} border-white/15 text-foreground-muted hover:text-foreground`}>Select all shown</button>
                            <button type="button" disabled={selected.size === 0} onClick={() => setSelected(new Map())} className={`${buttonClass} border-white/15 text-foreground-muted hover:text-foreground`}>Clear</button>
                        </span>
                    </div>
                    <ul className="mt-2 max-h-72 divide-y divide-white/10 overflow-y-auto border border-white/10" aria-label="Servers to target">
                        {results.page.items.map((server) => (
                            <li key={server.serverId}>
                                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs hover:bg-white/5">
                                    <input type="checkbox" checked={selected.has(server.serverId)} disabled={!selected.has(server.serverId) && full} onChange={(event) => toggle(server, event.target.checked)} className="size-4 accent-crimson" />
                                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-foreground">{server.displayName}</span><span className="text-foreground-muted">{hostingRegionLabel(server.friendlyRegion)} · {server.operationState}</span></span>
                                </label>
                            </li>
                        ))}
                        {results.page.items.length === 0 && <li className="px-3 py-6 text-center text-xs text-foreground-muted">No servers match.</li>}
                    </ul>
                    {results.page.nextCursor !== null && <button type="button" disabled={searching} onClick={() => void search(results.page.nextCursor)} className={`${buttonClass} mt-2 border-white/15 text-foreground-muted hover:text-foreground`}>Load more servers</button>}
                    <p className={`mt-3 text-xs ${full ? "text-amber-200" : "text-foreground-muted"}`} aria-live="polite">{selected.size} selected{full ? ` (the most a notice can target)` : ` of at most ${NOTICE_LIMITS.targets}`}</p>
                    {selected.size > 0 && <ul className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" aria-label="Selected servers">
                        {[...selected].map(([serverId, displayName]) => (
                            <li key={serverId} className="inline-flex items-center gap-1 border border-gold/30 bg-gold/8 py-0.5 pr-1 pl-2 text-xs text-gold">
                                {displayName}
                                <button type="button" aria-label={`Remove ${displayName}`} onClick={() => setSelected((current) => { const next = new Map(current); next.delete(serverId); return next; })} className="p-0.5 text-gold/70 hover:text-gold"><X aria-hidden="true" className="size-3" /></button>
                            </li>
                        ))}
                    </ul>}
                </fieldset>
                <div className="grid content-start gap-4">
                    <label className="block">
                        <span className={labelClass}>Title</span>
                        <input name="title" required maxLength={NOTICE_LIMITS.title} value={form.title} disabled={pending} onChange={(event) => setForm({ ...form, title: event.target.value })} className={inputClass} />
                    </label>
                    <label className="block">
                        <span className={labelClass}>Message</span>
                        <textarea name="body" required rows={6} maxLength={NOTICE_LIMITS.body} value={form.body} disabled={pending} onChange={(event) => setForm({ ...form, body: event.target.value })} className={`${inputClass} py-2`} />
                        <span className="mt-1 block text-[0.65rem] text-foreground-dim">Plain text; line breaks are kept. {form.body.length}/{NOTICE_LIMITS.body}</span>
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className={labelClass}>Severity</span>
                            <select name="severity" value={form.severity} disabled={pending} onChange={(event) => setForm({ ...form, severity: event.target.value === "warning" ? "warning" : "info" })} className={inputClass}>
                                <option value="info">Information</option>
                                <option value="warning">Warning</option>
                            </select>
                        </label>
                        <label className="block">
                            <span className={labelClass}>Expires (optional)</span>
                            <input name="expiresAt" type="datetime-local" value={form.expiresAt} disabled={pending} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} className={inputClass} />
                            <span className="mt-1 block text-[0.65rem] text-foreground-dim">Your local time; within a year. Empty keeps it until withdrawn.</span>
                        </label>
                    </div>
                    <label className="block">
                        <span className={labelClass}>Reason</span>
                        <input name="reason" maxLength={NOTICE_LIMITS.reason} value={form.reason} disabled={pending} placeholder="Recorded in the audit history" onChange={(event) => setForm({ ...form, reason: event.target.value })} className={inputClass} />
                    </label>
                </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="submit" disabled={pending} className={`${buttonClass} min-h-10 border-crimson bg-crimson px-5 text-white hover:bg-crimson-hover`}>
                    {pending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Megaphone aria-hidden="true" className="size-3.5" />}{pending ? "Posting" : "Post notice"}
                </button>
            </div>
            {result && <p role={result.ok ? "status" : "alert"} className={`mt-4 border-l-2 px-3 py-2 text-xs ${result.ok ? "border-emerald-500 bg-emerald-500/10 text-emerald-200" : "border-crimson bg-crimson/10 text-red-200"}`}>{result.message}</p>}
        </form>
    );
}

function NoticeList({ revision }: { revision: number }) {
    const [page, setPage] = useState<HostingPage<HostingAdminNotice> | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reload, setReload] = useState(0);
    const [withdrawing, setWithdrawing] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const first = await requestControlPlaneAdmin<HostingPage<HostingAdminNotice>>({
                    accessToken: await accessToken(),
                    requestId: crypto.randomUUID(),
                    operation: "notices",
                    input: { cursor: null, limit: NOTICE_PAGE_LIMIT },
                });
                if (cancelled) return;
                setPage(first);
                setError("");
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "Notices could not be loaded.");
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [revision, reload]);

    async function more() {
        if (page === null || page.nextCursor === null || loading) return;
        setLoading(true);
        setError("");
        try {
            const next = await requestControlPlaneAdmin<HostingPage<HostingAdminNotice>>({
                accessToken: await accessToken(),
                requestId: crypto.randomUUID(),
                operation: "notices",
                input: { cursor: page.nextCursor, limit: NOTICE_PAGE_LIMIT },
            });
            setPage((current) => current === null ? next : {
                items: [...current.items, ...next.items.filter((item) => !current.items.some((existing) => existing.noticeId === item.noticeId))],
                nextCursor: next.nextCursor,
            });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "More notices could not be loaded.");
        } finally {
            setLoading(false);
        }
    }

    async function withdraw(notice: HostingAdminNotice) {
        if (withdrawing !== null) return;
        if (!window.confirm(`Withdraw “${notice.title}”? It disappears for everyone on ${notice.targetCount} ${notice.targetCount === 1 ? "server's page" : "servers' pages"}.`)) return;
        setWithdrawing(notice.noticeId);
        setError("");
        try {
            const withdrawn = await requestControlPlaneAdmin<HostingAdminNotice>({
                accessToken: await accessToken(),
                requestId: crypto.randomUUID(),
                operation: "withdraw-notice",
                input: { noticeId: notice.noticeId },
            });
            setPage((current) => current === null ? current : {
                ...current,
                items: current.items.map((item) => item.noticeId === notice.noticeId ? { ...item, ...withdrawn, state: "withdrawn" } : item),
            });
        } catch (cause) {
            setError(noticeErrorMessage(cause, "The notice could not be withdrawn."));
        } finally {
            setWithdrawing(null);
        }
    }

    return (
        <section aria-labelledby="notice-list-heading">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">Newest first</p>
                    <h2 id="notice-list-heading" className="mt-1 font-display text-3xl font-semibold text-foreground">Notices</h2>
                </div>
                <span className="font-display text-xl text-foreground-muted">{page?.items.length ?? "…"}</span>
            </div>
            {error && <p role="alert" className="mt-4 border-l-2 border-crimson bg-crimson/10 px-3 py-2 text-xs text-red-200">{error} <button type="button" className="ml-2 underline" onClick={() => setReload((value) => value + 1)}>Reload</button></p>}
            <div className="mt-4 divide-y divide-white/10 border border-white/10 bg-surface">
                {page === null && !error && <p role="status" className="px-5 py-6 text-sm text-foreground-muted">Loading notices…</p>}
                {page?.items.length === 0 && <Empty>No notices yet.</Empty>}
                {page?.items.map((notice) => (
                    <article key={notice.noticeId} className="p-5" aria-label={notice.title}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`${badgeClass} ${NOTICE_STATE_BADGES[notice.state] ?? NOTICE_STATE_BADGES.expired}`}>{NOTICE_STATE_LABELS[notice.state] ?? notice.state}</span>
                                    <span className={`${badgeClass} ${notice.severity === "warning" ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-sky-400/30 bg-sky-400/10 text-sky-300"}`}>{notice.severity === "warning" ? "Warning" : "Information"}</span>
                                    <span className={`${badgeClass} border-white/15 text-foreground-muted`}>{noticeKindLabel(notice.kind)}</span>
                                </div>
                                <h3 className="mt-2 break-words text-base font-semibold text-foreground">{notice.title}</h3>
                            </div>
                            {notice.state === "active" && (
                                <button type="button" disabled={withdrawing !== null} onClick={() => void withdraw(notice)} className={`${buttonClass} border-crimson/50 text-red-200 hover:bg-crimson/10`}>
                                    {withdrawing === notice.noticeId && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />} Withdraw
                                </button>
                            )}
                        </div>
                        <p className="mt-2 max-w-4xl whitespace-pre-wrap break-words text-sm leading-6 text-foreground-muted">{notice.body}</p>
                        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-foreground-muted sm:grid-cols-2 lg:grid-cols-4">
                            <div><dt className="inline">Created </dt><dd className="inline text-foreground"><LocalDateTime value={notice.createdAt} /></dd></div>
                            <div><dt className="inline">Expires </dt><dd className="inline text-foreground"><LocalDateTime value={notice.expiresAt} empty="Never" /></dd></div>
                            <div><dt className="inline">Servers </dt><dd className="inline text-foreground">{notice.targetCount}</dd></div>
                            <div><dt className="inline">Dismissed </dt><dd className="inline text-foreground">{notice.dismissalCount}</dd></div>
                        </dl>
                        <p className="mt-2 text-xs text-foreground-muted">On {noticeTargetSummary(notice) || "no servers"}</p>
                        <p className="mt-1 text-xs text-foreground-dim">
                            By <span className="font-mono">{notice.createdBy}</span>{notice.reason ? ` · ${notice.reason}` : ""}
                            {notice.withdrawnAt !== null && <> · withdrawn <LocalDateTime value={notice.withdrawnAt} /></>}
                        </p>
                    </article>
                ))}
            </div>
            {page !== null && page.nextCursor !== null && <button type="button" disabled={loading} onClick={() => void more()} className={`${buttonClass} mt-3 border-white/15 text-foreground-muted hover:text-foreground`}>{loading && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />} Load older notices</button>}
        </section>
    );
}
