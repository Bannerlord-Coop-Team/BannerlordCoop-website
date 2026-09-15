"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { downloadMyServerLog } from "@/app/lib/hosting/server-files";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";

export function DownloadServerLogButton({ serverId, userId, className }: { serverId?: string; userId?: string; className: string }) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    async function download() {
        if (!serverId || !userId || pending) return;
        setPending(true);
        setError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session || session.user.id !== userId) throw new Error("Authentication changed. Refresh the page and try again.");
            const result = await downloadMyServerLog(session.access_token, serverId);
            const url = URL.createObjectURL(result.blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = result.filename;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        } catch (error) {
            setError(error instanceof Error ? error.message : "The log could not be downloaded. Try again.");
        } finally { setPending(false); }
    }

    return <>
        <button type="button" disabled={!serverId || !userId || pending} onClick={download}
            title="Download the latest .log file from the server's logs directory"
            className={className}>
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
            {pending ? "Downloading…" : "Download logs"}
        </button>
        {error && <p role="alert" className="max-w-sm text-sm text-red-300">{error}</p>}
    </>;
}
