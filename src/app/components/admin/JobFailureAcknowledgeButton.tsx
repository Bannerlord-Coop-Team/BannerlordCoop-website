"use client";

import { CheckCheck, LoaderCircle } from "lucide-react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function JobFailureAcknowledgeButton({
    jobId,
    expectedUpdatedAt,
}: {
    jobId: string;
    expectedUpdatedAt: string;
}) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    async function acknowledge() {
        const reason = window.prompt(
            "Why is this failure safe to silence? The job and its failure remain in history.",
        )?.trim();
        if (!reason) return;
        if (reason.length < 3) {
            setError("Enter at least three characters.");
            return;
        }
        setPending(true);
        setError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            await requestControlPlaneAdmin({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "acknowledge-job-failure",
                input: { jobId, expectedUpdatedAt, reason },
            });
            router.refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The failure could not be silenced.");
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="min-w-24">
            <button
                type="button"
                disabled={pending}
                onClick={acknowledge}
                title="Acknowledge this exact failed attempt. It remains in durable history but stops contributing to the Overview failed-job alert."
                className="inline-flex min-h-8 items-center gap-1.5 border border-white/15 px-2.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-foreground-muted hover:border-gold/40 hover:text-gold disabled:cursor-wait disabled:opacity-60"
            >
                {pending ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> : <CheckCheck aria-hidden="true" className="size-3" />}
                {pending ? "Saving" : "Silence"}
            </button>
            {error && <p role="alert" className="mt-1 max-w-48 text-[0.62rem] text-red-200">{error}</p>}
        </div>
    );
}
