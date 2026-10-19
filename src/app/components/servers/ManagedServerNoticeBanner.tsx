"use client";

import { Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import type { MyServerNotice } from "@/app/lib/control-plane/types";
import { isJoinAddress } from "@/app/lib/hosting/connection-address";
import { useTranslations } from "@/app/lib/localization/client";
import type { Translator } from "@/app/lib/localization/types";
import { dismissManagedServerNotice } from "@/app/servers/server-notice-actions";
import { moveCoversNotice, useManagedServerMove } from "./managed-server-move-context";
import { useViewerTimeZone, ZONED_DATE_TIME_FORMAT as START_FORMAT } from "./viewer-time-zone";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const END_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZoneName: "short" };

/**
 * Each undismissed notice on this server's page as a card. Administrator notices are shown as
 * written, as plain text; placement notices are written from their parameters in the viewer's
 * language and time zone, falling back to the stored English text when the parameters are unusable.
 * Placement notices that the move status card already covers are left to it.
 */
export function ManagedServerNoticeBanner({ serverId, notices }: { serverId: string; notices: readonly MyServerNotice[] }) {
    const { t, date } = useTranslations("managed-server");
    const timeZone = useViewerTimeZone();
    const move = useManagedServerMove();
    const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
    const [pending, setPending] = useState<string | null>(null);
    const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
    const visible = notices.filter((notice) => !hidden.has(notice.noticeId) && !moveCoversNotice(notice, move));
    if (visible.length === 0) return null;

    async function dismiss(noticeId: string) {
        if (pending !== null) return;
        setPending(noticeId);
        setErrors((current) => withoutKey(current, noticeId));
        let message: string | null = null;
        try {
            const result = await dismissManagedServerNotice({ serverId, noticeId });
            if (!result.ok) message = result.message;
        } catch {
            message = t("notices.dismissFailed");
        }
        if (message === null) setHidden((current) => new Set(current).add(noticeId));
        else setErrors((current) => ({ ...current, [noticeId]: message }));
        setPending(null);
    }

    const format = (value: string | number, options: Intl.DateTimeFormatOptions) => date(value, { ...options, timeZone });
    return (
        <section aria-label={t("notices.regionLabel")} className="mt-4 space-y-3">
            {visible.map((notice) => {
                const { title, body } = noticeText(notice, t, format);
                const warning = notice.severity === "warning";
                const Icon = warning ? TriangleAlert : Info;
                return (
                    <div key={notice.noticeId} role={warning ? "alert" : "status"}
                        className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${warning ? "border-amber-400/40 bg-amber-400/[0.08]" : "border-gold/30 bg-gold/[0.06]"}`}>
                        <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${warning ? "text-amber-300" : "text-gold"}`} />
                        <div className="min-w-0 flex-1">
                            <p className="break-words font-medium text-foreground"><span className="sr-only">{t(warning ? "notices.warning" : "notices.info")}: </span>{title}</p>
                            <p className="mt-1 whitespace-pre-wrap break-words leading-6 text-foreground-muted">{body}</p>
                            {errors[notice.noticeId] && <p className="mt-2 text-xs text-red-200">{errors[notice.noticeId]}</p>}
                        </div>
                        <button type="button" disabled={pending !== null} onClick={() => void dismiss(notice.noticeId)} aria-label={t("notices.dismissNamed", { title })}
                            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-3 text-xs text-foreground-muted hover:border-gold/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50">
                            {pending === notice.noticeId ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <X aria-hidden="true" className="size-3.5" />}
                            {t("notices.dismiss")}
                        </button>
                    </div>
                );
            })}
        </section>
    );
}

/** The title and message to show; untranslated stored text is plain user content and is never parsed. */
export function noticeText(
    notice: Pick<MyServerNotice, "kind" | "title" | "body" | "parameters">,
    t: Translator["t"],
    format: (value: string | number, options: Intl.DateTimeFormatOptions) => string,
): { title: string; body: string } {
    const { parameters } = notice;
    if (notice.kind === "placement-scheduled" && isTimestamp(parameters.scheduledAt)) {
        const minutes = parameters.windowMinutes;
        const start = Date.parse(parameters.scheduledAt);
        const body = typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0 && minutes <= 1_440
            ? t("notices.placementScheduledBody", { start: format(start, START_FORMAT), end: format(start + minutes * 60_000, END_FORMAT) })
            : t("notices.placementScheduledBodyAround", { time: format(start, START_FORMAT) });
        return { title: t("notices.placementScheduledTitle"), body };
    }
    if (notice.kind === "placement-completed") {
        const address = parameters.address;
        return {
            title: t("notices.placementCompletedTitle"),
            body: isJoinAddress(address)
                ? t("notices.placementCompletedBody", { address })
                : t("notices.placementCompletedBodyNoAddress"),
        };
    }
    return { title: notice.title, body: notice.body };
}

function isTimestamp(value: unknown): value is string {
    return typeof value === "string" && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function withoutKey(record: Readonly<Record<string, string>>, key: string) {
    const next = { ...record };
    delete next[key];
    return next;
}
