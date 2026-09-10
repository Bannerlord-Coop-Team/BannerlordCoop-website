"use client";

import { CheckCheck, LoaderCircle } from "lucide-react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function JobFailuresAcknowledgeButton({
    filter,
    disabled,
}: {
    filter: Record<string, string | boolean>;
    disabled: boolean;
}) {
    const router = useRouter();
    const [editing, setEditing] = useState(false);
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    function beginAcknowledgement() {
        setEditing(true);
        setError("");
    }

    function cancelAcknowledgement() {
        setEditing(false);
        setReason("");
        setError("");
    }

    async function acknowledge(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const normalizedReason = reason.trim();
        if (normalizedReason.length < 3) {
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
                operation: "acknowledge-job-failures",
                input: { filter, reason: normalizedReason },
            });
            setEditing(false);
            setReason("");
            router.refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The matching failures could not be silenced.");
        } finally {
            setPending(false);
        }
    }

    if (editing) {
        return (
            <form onSubmit={acknowledge} className="w-full border border-gold/30 bg-background/40 p-3 lg:max-w-sm">
                <label htmlFor="job-failures-acknowledgement-reason" className="block text-xs text-foreground-muted">
                    Reason for silencing
                </label>
                <input
                    id="job-failures-acknowledgement-reason"
                    autoFocus
                    maxLength={1_000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={pending}
                    className="mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground outline-none focus:border-gold disabled:opacity-60"
                />
                <p className="mt-2 text-[0.62rem] leading-4 text-foreground-muted">
                    This acknowledges every currently matching failed attempt. Job and audit history remain durable.
                </p>
                <div className="mt-3 flex gap-2">
                    <button
                        type="button"
                        disabled={pending}
                        onClick={cancelAcknowledgement}
                        className="min-h-9 flex-1 border border-white/15 px-3 font-label text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-foreground-muted hover:border-white/30 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={pending}
                        className="inline-flex min-h-9 flex-1 items-center justify-center gap-2 border border-gold/40 px-3 font-label text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-gold hover:bg-gold/10 disabled:cursor-wait disabled:opacity-60"
                    >
                        {pending && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
                        {pending ? "Silencing" : "Confirm silence"}
                    </button>
                </div>
                {error && <p role="alert" className="mt-2 text-[0.62rem] text-red-200">{error}</p>}
            </form>
        );
    }

    return (
        <div className="lg:max-w-64">
            <button
                type="button"
                disabled={disabled}
                onClick={beginAcknowledgement}
                title="Acknowledge every unacknowledged failed attempt matching the current action and server filters. Durable history is retained."
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 border border-gold/40 px-4 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
                <CheckCheck aria-hidden="true" className="size-3.5" />
                Silence all matching
            </button>
        </div>
    );
}
