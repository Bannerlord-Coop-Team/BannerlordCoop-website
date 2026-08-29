"use client";

import { CheckCheck, LoaderCircle } from "lucide-react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function JobFailuresAcknowledgeButton({
    filter,
    disabled,
}: {
    filter: Record<string, string | boolean>;
    disabled: boolean;
}) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    async function acknowledge() {
        const reason = window.prompt(
            "Why are all currently matching failures safe to silence? Durable job and audit history will be retained.",
        )?.trim();
        if (!reason) return;
        if (reason.length < 3) {
            setError("Enter at least three characters.");
            return;
        }
        if (!window.confirm("Silence every unacknowledged failure matching the current filters?")) return;
        setPending(true);
        setError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            await requestControlPlaneAdmin({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "acknowledge-job-failures",
                input: { filter, reason },
            });
            router.refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The matching failures could not be silenced.");
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="lg:max-w-64">
            <button
                type="button"
                disabled={disabled || pending}
                onClick={acknowledge}
                title="Acknowledge every unacknowledged failed attempt matching the current action and server filters. Durable history is retained."
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 border border-gold/40 px-4 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
                {pending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <CheckCheck aria-hidden="true" className="size-3.5" />}
                {pending ? "Silencing" : "Silence all matching"}
            </button>
            {error && <p role="alert" className="mt-1 text-[0.62rem] text-red-200">{error}</p>}
        </div>
    );
}
