"use client";

import { setServerVisibility } from "@/app/servers/server-visibility-actions";
import { Check, ChevronDown, Globe2, LockKeyhole } from "lucide-react";
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
    const picker = useRef<HTMLDetailsElement>(null);
    const [pending, startTransition] = useTransition();
    const [message, setMessage] = useState("");
    const isPublic = visibility === "public";
    const request = useRef<{
        serverId: string; visibility: "private" | "public"; expectedUpdatedAt: string; requestId: string;
    } | null>(null);
    function changeVisibility(target: "private" | "public") {
        if (accessRole !== "owner" || pending || target === (isPublic ? "public" : "private")) return;
        if (target === "public" && !window.confirm("Mark this server public for discovery? This records your opt-in preference; public listing is not available yet. It does not change game connection permissions.")) return;
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
                    if (picker.current) {
                        picker.current.open = false;
                        picker.current.querySelector("summary")?.focus();
                    }
                    router.refresh();
                }
            } catch { setMessage("The update could not be confirmed. Try again to retry the same request, or refresh to check the current preference."); }
        });
    }
    const label = isPublic ? "Public" : "Private";
    const Icon = isPublic ? Globe2 : LockKeyhole;
    return <div className="relative ml-auto">
        {accessRole === "owner" ? <details ref={picker} className="relative" onKeyDown={event => {
            if (event.key === "Escape" && picker.current) {
                picker.current.open = false;
                picker.current.querySelector("summary")?.focus();
            }
        }}>
            <summary aria-label={`Directory visibility: ${label}. Edit visibility`} className="inline-flex min-h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-foreground hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden">
                <Icon className="size-4" aria-hidden="true" />{pending ? "Saving…" : label}<ChevronDown className="size-3" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-3rem)] rounded-lg border border-white/15 bg-surface-raised p-1 shadow-xl">
                <div role="group" aria-label="Directory visibility">
                    {(["private", "public"] as const).map(value => {
                        const selected = value === (isPublic ? "public" : "private");
                        const OptionIcon = value === "public" ? Globe2 : LockKeyhole;
                        return <button key={value} type="button" disabled={pending || selected} aria-pressed={selected} onClick={() => changeVisibility(value)}
                            className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-default disabled:opacity-60">
                            <OptionIcon className="size-4" aria-hidden="true" />{value === "public" ? "Public" : "Private"}{selected && <Check className="ml-auto size-4" aria-hidden="true" />}
                        </button>;
                    })}
                </div>
                <p className="border-t border-white/10 px-3 py-2 text-xs leading-5 text-foreground-muted">This saves your discovery preference. Public listing is not available yet. Visibility does not change management access or game connection permissions.</p>
            </div>
        </details> : <span title="Only the server owner can change visibility." className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm text-foreground-muted"><Icon className="size-4" aria-hidden="true" />{label}<span className="sr-only">Only the server owner can change visibility.</span></span>}
        <p role="status" className="max-w-64 text-xs text-foreground-muted">{message}</p>
    </div>;
}
