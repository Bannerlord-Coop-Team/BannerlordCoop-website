"use client";

import { setServerVisibility } from "@/app/servers/server-visibility-actions";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
    function changeVisibility() {
        if (accessRole !== "owner" || pending) return;
        if (!isPublic && !window.confirm("Publish this server? Everyone will be able to see its name, region, game IP and port. This does not change the game password or connection permissions.")) return;
        setMessage("");
        startTransition(async () => {
            try {
                const result = await setServerVisibility({ serverId, visibility: isPublic ? "private" : "public", expectedUpdatedAt, requestId: crypto.randomUUID() });
                setMessage(result.message);
                router.refresh();
            } catch { setMessage("Visibility could not be updated. Refresh before trying again."); }
        });
    }
    return (
        <section className="mt-6 border border-white/10 bg-surface p-5" aria-labelledby="server-visibility-heading">
            <h2 id="server-visibility-heading" className="font-display text-xl font-semibold">Server visibility: {isPublic ? "Public" : "Private"}</h2>
            <p className="mt-2 text-sm text-foreground-muted">
                Private servers are not listed publicly. Eligible public servers share their name, region, game IP and port with everyone.
                Suspended, deleted, or entitlement-inactive servers are excluded; ownership transfers reset visibility to private.
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
