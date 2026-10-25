"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { downloadMyServerLog } from "@/app/lib/hosting/server-files";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";

/** How long the empty-log notice stays beside the button. */
const NOTICE_MILLISECONDS = 10_000;

// Presents authenticated log downloads with detailed localized diagnostics.
export function DownloadServerLogButton({ serverId, userId, className }: { serverId?: string; userId?: string; className: string }) {
    const { t } = useTranslations("managed-server");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    // Downloads original log bytes after the existing account check; an empty log is reported instead of saved.
    async function download() {
        if (!serverId || !userId || pending) return;
        setPending(true);
        setError("");
        setNotice("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient(t("log.authentication")).auth.getSession();
            if (!session || session.user.id !== userId) throw new Error(t("downloadServerLogButton.authenticationChangedRefreshThePageAndTryAgain"));
            const result = await downloadMyServerLog(session.access_token, serverId, {
                notFound: t("log.notFound"), tooLarge: t("log.tooLarge"), unavailable: t("log.unavailable"),
                incomplete: t("log.incomplete"), invalid: t("log.invalid"),
                endpoint: { notConfigured: t("log.notConfigured"), invalidUrl: t("log.invalidUrl"), invalidKey: t("log.invalidKey") },
            });
            if (result.blob.size === 0) {
                setNotice(t("downloadServerLogButton.theServerSLogFileIsEmptyRightNowIt"));
                window.setTimeout(() => setNotice(""), NOTICE_MILLISECONDS);
                return;
            }
            const url = URL.createObjectURL(result.blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = result.filename;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        } catch (error) {
            setError(error instanceof Error ? error.message : t("downloadServerLogButton.theLogCouldNotBeDownloadedTryAgain"));
        } finally { setPending(false); }
    }

    // Feedback floats under the button so toolbars never reflow around it.
    return <span className="relative inline-flex">
        <button type="button" disabled={!serverId || !userId || pending} onClick={download}
            title={t("downloadServerLogButton.downloadTheLatestLogFileFromTheServerSLogs")}
            className={className}>
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
            {pending ? t("downloadServerLogButton.downloading") : t("downloadServerLogButton.downloadLogs")}
        </button>
        {error && <p role="alert" className="absolute top-full right-0 z-20 mt-1 w-72 rounded-md border border-red-400/30 bg-surface-raised p-3 text-sm text-red-300 shadow-xl">{error}</p>}
        {notice && <p role="status" className="absolute top-full right-0 z-20 mt-1 w-72 rounded-md border border-white/15 bg-surface-raised p-3 text-sm text-foreground-muted shadow-xl">{notice}</p>}
    </span>;
}
