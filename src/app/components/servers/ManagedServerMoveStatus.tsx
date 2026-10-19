"use client";

import { ArrowRightLeft, CalendarClock, Check, CircleCheck, Copy, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useContext, useEffect, useEffectEvent, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { MyServerMove, MyServerNotice } from "@/app/lib/control-plane/types";
import { isMoveInProgress, SERVER_MOVE_STEPS } from "@/app/lib/hosting/server-move";
import { useTranslations } from "@/app/lib/localization/client";
import type { Translator } from "@/app/lib/localization/types";
import { readManagedServerMoveStatus } from "@/app/servers/managed-server-move-actions";
import { dismissManagedServerNotice } from "@/app/servers/server-notice-actions";
import { ManagedServerMoveContext } from "./managed-server-move-context";
import { useRevealServerAddress } from "./ServerManagementWorkspace";
import { useViewerTimeZone, ZONED_DATE_TIME_FORMAT } from "./viewer-time-zone";

/** Without a move to follow, a page checks once a minute; an announced move every 30 s. */
const IDLE_POLL_MILLISECONDS = 60_000;
const SCHEDULED_POLL_MILLISECONDS = 30_000;
/** Moves that are starting or under way, and the last two minutes before one, are followed every 5 s. */
const ACTIVE_POLL_MILLISECONDS = 5_000;
const FINAL_COUNTDOWN_MILLISECONDS = 2 * 60_000;
/** Failed reads back off from the usual delay up to this, keeping the status last shown. */
const MAXIMUM_RETRY_MILLISECONDS = 5 * 60_000;
const COPY_FEEDBACK_MILLISECONDS = 2_000;
/** One remembered dismissal per server: the finished move it hid, by its completion time. */
const DISMISSAL_STORAGE_PREFIX = "bannerlordcoop.servers.moveDismissed.";

const dismissButtonClass = "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-3 text-xs text-foreground-muted hover:border-gold/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold";

/** The wait before the next move-status read: the closer the move, the sooner. */
export function serverMovePollDelay(move: MyServerMove | null, now: number, failures = 0) {
    let delay = IDLE_POLL_MILLISECONDS;
    if (move?.state === "scheduled") {
        // Reads speed up exactly when the final two minutes begin.
        const untilFinalCountdown = (move.scheduledAt === null ? Number.NaN : Date.parse(move.scheduledAt)) - FINAL_COUNTDOWN_MILLISECONDS - now;
        delay = Number.isNaN(untilFinalCountdown) ? SCHEDULED_POLL_MILLISECONDS
            : untilFinalCountdown <= 0 ? ACTIVE_POLL_MILLISECONDS
                : Math.min(SCHEDULED_POLL_MILLISECONDS, Math.max(ACTIVE_POLL_MILLISECONDS, untilFinalCountdown));
    } else if (move?.state === "starting" || isMoveInProgress(move)) {
        delay = ACTIVE_POLL_MILLISECONDS;
    }
    return failures === 0 ? delay : Math.min(delay * 2 ** failures, MAXIMUM_RETRY_MILLISECONDS);
}

// The parts of a move that change server-rendered status (header, address, notices); a new step alone does not.
function serverMoveRefreshKey(move: MyServerMove | null) {
    return move === null ? "none" : `${move.state}|${move.completedAt ?? ""}|${move.address ?? ""}`;
}

/**
 * Follows one server's move to another machine for the whole page, so the status card, notices, lifecycle
 * controls and console agree. Reads run only while the page is visible and catch up as soon as it is shown
 * again; a change the server-rendered page shows refreshes it once.
 */
export function ManagedServerMoveProvider({ serverId, initialMove, children }: { serverId: string; initialMove: MyServerMove | null; children: ReactNode }) {
    const router = useRouter();
    const [move, setMove] = useState(initialMove);
    const latest = useRef(initialMove);
    const failures = useRef(0);

    // Applies one read: a failure keeps the status already shown and backs off.
    const applyRead = useEffectEvent((result: Awaited<ReturnType<typeof readManagedServerMoveStatus>>) => {
        if (!result.ok) {
            failures.current += 1;
            return;
        }
        failures.current = 0;
        const changed = serverMoveRefreshKey(result.move) !== serverMoveRefreshKey(latest.current);
        latest.current = result.move;
        setMove(result.move);
        if (changed) router.refresh();
    });

    useEffect(() => {
        let cancelled = false;
        let timer: number | undefined;
        let readWhenVisible = false;

        // Reads now while the page is visible; a hidden page waits until it is shown again.
        async function read() {
            timer = undefined;
            if (document.visibilityState === "hidden") {
                readWhenVisible = true;
                return;
            }
            const result = await readManagedServerMoveStatus(serverId).catch(() => ({ ok: false as const }));
            if (cancelled) return;
            applyRead(result);
            schedule();
        }

        function schedule() {
            timer = window.setTimeout(read, serverMovePollDelay(latest.current, Date.now(), failures.current));
        }

        // Catches up immediately when the owner returns to a page that skipped a read.
        function readOnReturn() {
            if (document.visibilityState !== "visible" || !readWhenVisible) return;
            readWhenVisible = false;
            void read();
        }

        schedule();
        document.addEventListener("visibilitychange", readOnReturn);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", readOnReturn);
        };
    }, [serverId]);

    return <ManagedServerMoveContext.Provider value={{ serverId, move }}>{children}</ManagedServerMoveContext.Provider>;
}

/**
 * The move status card above the server's notices: the countdown to an announced move, its steps while it
 * runs, and the outcome with the new address. Changes are announced politely once each, not every second.
 */
export function ManagedServerMoveStatus({ notices }: { notices: readonly MyServerNotice[] }) {
    const context = useContext(ManagedServerMoveContext);
    const { t, date } = useTranslations("managed-server");
    const timeZone = useViewerTimeZone();
    const revealAddress = useRevealServerAddress();
    const headingId = useId();
    const move = context?.move ?? null;
    const serverId = context?.serverId ?? "";
    const storageKey = `${DISMISSAL_STORAGE_PREFIX}${serverId}`;
    const storedDismissal = useSyncExternalStore(subscribeToStorage, () => readDismissal(storageKey), () => null);
    const [dismissedNow, setDismissedNow] = useState<string | null>(null);
    const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
    const now = useSecondClock(move?.state === "scheduled" || isMoveInProgress(move));
    const previousState = useRef(move?.state ?? null);

    useEffect(() => {
        const previous = previousState.current;
        previousState.current = move?.state ?? null;
        // A move that finishes while the page is open also reveals the new address in the header.
        if (move?.state === "moved" && previous !== "moved") revealAddress();
    }, [move?.state, revealAddress]);

    useEffect(() => {
        if (copy !== "copied") return;
        const timer = window.setTimeout(() => setCopy(null), COPY_FEEDBACK_MILLISECONDS);
        return () => window.clearTimeout(timer);
    }, [copy]);

    if (context === null) return null;
    const finished = move?.state === "moved" || move?.state === "failed";
    const dismissed = finished && move.completedAt !== null && (storedDismissal === move.completedAt || dismissedNow === move.completedAt);
    const shown = move !== null && !dismissed ? move : null;
    const title = shown === null ? null : moveTitle(shown, t);
    const currentStep = shown?.state === "moving" ? Math.max(0, SERVER_MOVE_STEPS.indexOf(shown.step ?? "preparing")) : -1;
    // Announced with the heading: the step a move reached, or that the server is going back.
    const progress = currentStep >= 0 ? t("move.currentStep", { step: t(`move.step.${SERVER_MOVE_STEPS[currentStep]}`) })
        : shown?.state === "returning" ? t("move.returningProgress") : null;
    const elapsed = isMoveInProgress(shown) && shown.startedAt !== null && now !== null
        ? t("move.elapsed", { duration: formatDuration(Math.max(0, Math.floor((now - Date.parse(shown.startedAt)) / 1_000)), t) })
        : null;

    // Hides a finished move for this browser and dismisses the completion notice it replaced, where the viewer may.
    function dismiss() {
        if (shown === null || shown.completedAt === null) return;
        setDismissedNow(shown.completedAt);
        writeDismissal(storageKey, shown.completedAt);
        if (shown.state !== "moved") return;
        for (const notice of notices) {
            if (notice.kind === "placement-completed") {
                void dismissManagedServerNotice({ serverId, noticeId: notice.noticeId }).catch(() => undefined);
            }
        }
    }

    async function copyAddress(address: string) {
        try {
            await navigator.clipboard.writeText(address);
            setCopy("copied");
        } catch {
            setCopy("failed");
        }
    }

    const tone = shown === null ? null : moveTone(shown);
    return <>
        <p role="status" aria-live="polite" className="sr-only">{title}{progress && <> {progress}</>}</p>
        {shown !== null && tone !== null && <section aria-labelledby={headingId} className={`mt-4 flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${tone.card}`}>
            <tone.icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone.iconClass}`} />
            <div className="min-w-0 flex-1">
                <h2 id={headingId} className="break-words font-medium text-foreground">{title}</h2>
                {shown.state === "scheduled" && <>
                    {now !== null && shown.scheduledAt !== null && <p className="mt-2 font-display text-lg font-semibold tabular-nums text-foreground">
                        {Date.parse(shown.scheduledAt) > now
                            ? t("move.startsIn", { duration: formatDuration(Math.ceil((Date.parse(shown.scheduledAt) - now) / 1_000), t) })
                            : t("move.startsAnyMoment")}
                    </p>}
                    {shown.scheduledAt !== null && <p className="mt-1 text-xs text-foreground-muted">
                        {t("move.scheduledFor", { time: date(shown.scheduledAt, { ...ZONED_DATE_TIME_FORMAT, timeZone }) })}</p>}
                    <p className="mt-2 leading-6 text-foreground-muted">{t("move.scheduledBody")}</p>
                </>}
                {shown.state === "starting" && <p className="mt-1 leading-6 text-foreground-muted">{t("move.startingBody")}</p>}
                {shown.state === "moving" && <>
                    {elapsed && <p className="mt-1 text-xs tabular-nums text-foreground-muted">{elapsed}</p>}
                    <ol aria-label={t("move.stepsLabel")} className="mt-3 space-y-2">
                        {SERVER_MOVE_STEPS.map((step, index) => <li key={step} aria-current={index === currentStep ? "step" : undefined}
                            className={`flex items-center gap-2 ${index <= currentStep ? "text-foreground" : "text-foreground-dim"}`}>
                            {index < currentStep
                                ? <Check aria-hidden="true" className="size-4 text-gold" />
                                : index === currentStep ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-gold motion-reduce:animate-none" />
                                    : <span aria-hidden="true" className="size-4 rounded-full border border-white/20" />}
                            <span>{t(`move.step.${step}`)}<span className="sr-only">{index < currentStep ? t("controls.completed") : index === currentStep ? t("controls.currentPhase") : t("controls.waiting")}</span></span>
                        </li>)}
                    </ol>
                    <p className="mt-3 leading-6 text-foreground-muted">{t("move.movingBody")}</p>
                </>}
                {shown.state === "returning" && <>
                    <p className="mt-1 flex items-center gap-2 text-foreground">
                        <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-amber-300 motion-reduce:animate-none" />{t("move.returningProgress")}</p>
                    {elapsed && <p className="mt-1 text-xs tabular-nums text-foreground-muted">{elapsed}</p>}
                    <p className="mt-2 leading-6 text-foreground-muted">{t("move.returningBody")}</p>
                </>}
                {shown.state === "moved" && (shown.address !== null ? <>
                    <p className="mt-1 leading-6 text-foreground-muted">{t("move.movedBody")}</p>
                    <p className="mt-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">{t("move.newAddress")}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                        <span className="select-all break-all font-mono text-xl font-semibold text-foreground sm:text-2xl">{shown.address}</span>
                        <button type="button" aria-live="polite" onClick={() => void copyAddress(shown.address!)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm text-emerald-200 hover:border-emerald-400 focus-visible:outline-2 focus-visible:outline-gold">
                            <Copy aria-hidden="true" className="size-4" />{copy === "copied" ? t("move.copied") : t("move.copyAddress")}</button>
                    </div>
                    {copy === "failed" && <p className="mt-2 text-xs text-foreground-muted">{t("move.copyFailed")}</p>}
                </> : <p className="mt-1 leading-6 text-foreground-muted">{t("move.movedBodyNoAddress")}</p>)}
                {shown.state === "failed" && <p className="mt-1 leading-6 text-foreground-muted">
                    {t(shown.stayedOnOriginal === true ? "move.failedStayedBody" : "move.failedAttentionBody")}</p>}
            </div>
            {finished && <button type="button" onClick={dismiss} aria-label={t("notices.dismissNamed", { title: title! })} className={dismissButtonClass}>
                <X aria-hidden="true" className="size-3.5" />{t("notices.dismiss")}</button>}
        </section>}
    </>;
}

// Each state's heading; a failed move reads differently when the server is safely where it was.
function moveTitle(move: MyServerMove, t: Translator["t"]) {
    switch (move.state) {
        case "scheduled": return t("move.scheduledTitle");
        case "starting": return t("move.startingTitle");
        case "moving": return t("move.movingTitle");
        case "returning": return t("move.returningTitle");
        case "moved": return t("move.movedTitle");
        case "failed": return t(move.stayedOnOriginal === true ? "move.failedStayedTitle" : "move.failedAttentionTitle");
    }
}

// Matches the notice cards: gold while a move is pending or running, amber when it needs care, green once moved.
function moveTone(move: MyServerMove): { card: string; icon: typeof Info; iconClass: string } {
    if (move.state === "moved") return { card: "border-emerald-500/30 bg-emerald-500/[0.08]", icon: CircleCheck, iconClass: "text-emerald-300" };
    if (move.state === "failed") return move.stayedOnOriginal === true
        ? { card: "border-white/15 bg-surface", icon: Info, iconClass: "text-foreground-muted" }
        : { card: "border-amber-400/40 bg-amber-400/[0.08]", icon: TriangleAlert, iconClass: "text-amber-300" };
    if (move.state === "returning") return { card: "border-amber-400/40 bg-amber-400/[0.08]", icon: TriangleAlert, iconClass: "text-amber-300" };
    if (move.state === "scheduled") return { card: "border-gold/30 bg-gold/[0.06]", icon: CalendarClock, iconClass: "text-gold" };
    if (move.state === "moving") return { card: "border-gold/30 bg-gold/[0.06]", icon: ArrowRightLeft, iconClass: "text-gold" };
    return { card: "border-gold/30 bg-gold/[0.06]", icon: LoaderCircle, iconClass: "animate-spin text-gold motion-reduce:animate-none" };
}

// Writes a whole-second duration with its two largest units, such as "42 min 10 s".
function formatDuration(totalSeconds: number, t: Translator["t"]) {
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return t("move.durationHours", { hours, minutes });
    if (minutes > 0) return t("move.durationMinutes", { minutes, seconds });
    return t("move.durationSeconds", { seconds });
}

/** The current time, updated each second while active; null on the server and while hydrating, so both render alike. */
function useSecondClock(active: boolean) {
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        if (!active) return;
        const tick = () => setNow(Date.now());
        const first = window.setTimeout(tick, 0);
        const interval = window.setInterval(tick, 1_000);
        return () => {
            window.clearTimeout(first);
            window.clearInterval(interval);
        };
    }, [active]);
    return active ? now : null;
}

// Another tab's dismissal hides the card here too.
function subscribeToStorage(listener: () => void) {
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
}

function readDismissal(key: string) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeDismissal(key: string, completedAt: string) {
    try {
        window.localStorage.setItem(key, completedAt);
    } catch {
        // Storage can be unavailable (such as some private windows); the card still stays hidden on this page.
    }
}
