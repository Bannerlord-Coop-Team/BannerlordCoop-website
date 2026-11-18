"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "@/app/lib/localization/client";
import { RotateCw } from "lucide-react";
import { useTransition } from "react";

/** Explicitly distinguishes a malformed server payload from an access refusal. */
export function ManagedServerLoadError() {
    const { t } = useTranslations("managed-server");
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    return <section role="alert" aria-live="polite" className="rounded-lg border border-crimson/30 bg-crimson/[0.06] p-4 text-sm leading-6">
        <p className="text-foreground-muted">{t("page.serverCouldNotLoadRetry")}</p>
        <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-gold/40 px-3 text-gold hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50">
            <RotateCw aria-hidden="true" className={"size-4 " + (pending ? "animate-spin motion-reduce:animate-none" : "")} />
            {t("controls.checkNow")}
        </button>
    </section>;
}
