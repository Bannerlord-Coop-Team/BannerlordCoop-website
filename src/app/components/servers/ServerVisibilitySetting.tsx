"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { setServerVisibility } from "@/app/servers/server-visibility-actions";
import { Check, ChevronDown, Globe2, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Bounds the "Saving…" label when a replayed receipt leaves the refreshed preference unchanged.
const ACKNOWLEDGEMENT_MILLISECONDS = 6_000;

type Props = {
    serverId: string;
    visibility?: "public" | "private";
    accessRole: "owner" | "manager" | "support" | "admin";
    expectedUpdatedAt: string;
};
// Presents and confirms the existing owner-only directory preference.
export function ServerVisibilitySetting({ serverId, visibility, accessRole, expectedUpdatedAt }: Props) {
    const { t } = useTranslations("managed-server");
    const router = useRouter();
    const picker = useRef<HTMLDetailsElement>(null);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState("");
    const [acknowledged, setAcknowledged] = useState<{ target: "private" | "public"; message: string } | null>(null);
    const isPublic = visibility === "public";
    const current = isPublic ? "public" : "private";
    // The acknowledgement only matters until refreshed props show the requested preference.
    if (acknowledged !== null && acknowledged.target === current) setAcknowledged(null);
    const request = useRef<{
        serverId: string; visibility: "private" | "public"; expectedUpdatedAt: string; requestId: string;
    } | null>(null);
    useEffect(() => {
        if (acknowledged === null) return;
        const timer = window.setTimeout(() => setAcknowledged(null), ACKNOWLEDGEMENT_MILLISECONDS);
        return () => window.clearTimeout(timer);
    }, [acknowledged]);
    useEffect(() => {
        // Closes the open menu when the pointer or keyboard focus moves elsewhere on the page.
        function closeOutside(event: Event) {
            const details = picker.current;
            if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
        }
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("focusin", closeOutside);
        return () => {
            document.removeEventListener("pointerdown", closeOutside);
            document.removeEventListener("focusin", closeOutside);
        };
    }, []);
    // Confirms publishing before dispatching the retained visibility request.
    function changeVisibility(target: "private" | "public") {
        if (accessRole !== "owner" || pending || target === current) return;
        if (target === "public" && !window.confirm(t("visibilitySetting.makeThisServerDiscoverableInThePublicDirectoryWithIts"))) return;
        if (!request.current || request.current.serverId !== serverId || request.current.visibility !== target
            || request.current.expectedUpdatedAt !== expectedUpdatedAt) {
            request.current = { serverId, visibility: target, expectedUpdatedAt, requestId: crypto.randomUUID() };
        }
        const attempt = request.current;
        setError("");
        startTransition(async () => {
            try {
                const result = await setServerVisibility(attempt);
                if (result.ok) {
                    request.current = null;
                    setAcknowledged({ target, message: result.message });
                    if (picker.current) {
                        picker.current.open = false;
                        picker.current.querySelector("summary")?.focus();
                    }
                    router.refresh();
                } else setError(result.message);
            } catch { setError(t("visibilitySetting.theUpdateCouldNotBeConfirmedTryAgainToRetry")); }
        });
    }
    const label = isPublic ? t("visibilitySetting.public") : t("visibilitySetting.private");
    const Icon = isPublic ? Globe2 : LockKeyhole;
    return <div className="relative ml-auto">
        {accessRole === "owner" ? <details ref={picker} className="relative" onKeyDown={event => {
            if (event.key === "Escape" && picker.current) {
                picker.current.open = false;
                picker.current.querySelector("summary")?.focus();
            }
        }}>
            <summary aria-label={t("visibilitySetting.directoryVisibilityLabelEditVisibility", { label: label })} className="inline-flex min-h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-foreground hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden">
                <Icon className="size-4" aria-hidden="true" />{pending || acknowledged !== null ? t("visibilitySetting.saving") : label}<ChevronDown className="size-3" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-3rem)] rounded-lg border border-white/15 bg-surface-raised p-1 shadow-xl">
                <div role="group" aria-label={t("visibilitySetting.directoryVisibility")}>
                    {(["private", "public"] as const).map(value => {
                        const selected = value === current;
                        const OptionIcon = value === "public" ? Globe2 : LockKeyhole;
                        return <button key={value} type="button" disabled={pending || selected} aria-pressed={selected} onClick={() => changeVisibility(value)}
                            className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-default disabled:opacity-60">
                            <OptionIcon className="size-4" aria-hidden="true" />{value === "public" ? t("visibilitySetting.public") : t("visibilitySetting.private")}{selected && <Check className="ml-auto size-4" aria-hidden="true" />}
                        </button>;
                    })}
                </div>
                {/* Failures stay inside the menu that caused them, so the header never shifts. */}
                <p role="status" className={error ? "border-t border-white/10 px-3 py-2 text-xs leading-5 text-red-200" : "sr-only"}>{error}</p>
                <p className="border-t border-white/10 px-3 py-2 text-xs leading-5 text-foreground-muted">{t("visibilitySetting.publicVisibilityAllowsThisServerToAppearInThePublic")}</p>
            </div>
        </details> : <span title={t("visibilitySetting.onlyTheServerOwnerCanChangeVisibility")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm text-foreground-muted"><Icon className="size-4" aria-hidden="true" />{label}<span className="sr-only">{t("visibilitySetting.onlyTheServerOwnerCanChangeVisibility")}</span></span>}
        <p role="status" className="sr-only">{acknowledged?.message}</p>
    </div>;
}
