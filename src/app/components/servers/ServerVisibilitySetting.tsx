"use client";

import { setServerVisibility } from "@/app/servers/server-visibility-actions";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type Props = {
    serverId: string;
    visibility?: "public" | "private";
    accessRole: "owner" | "manager" | "support" | "admin";
    expectedUpdatedAt: string;
};
export function ServerVisibilitySetting({ serverId, visibility, accessRole, expectedUpdatedAt }: Props) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [message, setMessage] = useState("");
    const isPublic = visibility === "public";
    const request = useRef<{
        serverId: string; visibility: "private" | "public"; expectedUpdatedAt: string; requestId: string;
    } | null>(null);
    function changeVisibility() {
        if (accessRole !== "owner" || pending) return;
        if (!isPublic && !window.confirm("Mark this server public for discovery? This records your opt-in preference; public listing is not available yet. It does not change game connection permissions.")) return;
        const target = isPublic ? "private" : "public";
        if (!request.current || request.current.serverId !== serverId || request.current.visibility !== target
            || request.current.expectedUpdatedAt !== expectedUpdatedAt) {
            request.current = { serverId, visibility: target, expectedUpdatedAt, requestId: crypto.randomUUID() };
        }
        const attempt = request.current;
        setMessage("");
        startTransition(async () => {
            try {
                const result = await setServerVisibility(attempt);
                setMessage(result.message);
                if (result.ok) {
                    request.current = null;
                    router.refresh();
                }
            } catch { setMessage("The update could not be confirmed. Try again to retry the same request, or refresh to check the current preference."); }
        });
    }
    return (
        <section className="mt-6 border border-white/10 bg-surface p-5" aria-labelledby="server-visibility-heading">
            <h2 id="server-visibility-heading" className="font-display text-xl font-semibold">Server visibility: {isPublic ? "Public" : "Private"}</h2>
            <p className="mt-2 text-sm text-foreground-muted">
                This saves your discovery preference. Public listing is not available yet.
                Both settings preserve existing authorized access to this server and its game address.
                This setting does not block game connections or erase addresses people previously copied.
            </p>
            {accessRole === "owner" ? (
                <button type="button" disabled={pending} onClick={changeVisibility}
                    className="mt-4 min-h-10 border border-gold/35 px-4 font-label text-sm text-gold disabled:opacity-50">
                    {pending ? "Saving…" : isPublic ? "Make private" : "Make public"}
                </button>
            ) : <p className="mt-3 text-sm text-foreground-muted">Only the server owner can change visibility.</p>}
            <p role="status" className="mt-2 text-sm text-foreground-muted">{message}</p>
        </section>
    );
}
