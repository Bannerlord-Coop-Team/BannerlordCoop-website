"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "@/app/lib/localization/client";
import { RotateCw } from "lucide-react";
import { useTransition } from "react";

/** Lets a server page recover from a short control-plane outage without a server-render error page. */
export function ManagedServerUnavailable() {
    const { t } = useTranslations("managed-server");
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    return <section role="status" aria-live="polite" className="rounded-lg border border-gold/25 bg-gold/[0.04] p-4 text-sm leading-6">
        <p className="text-foreground-muted">{t("action.config.theHostingServiceCouldNotBeReachedTryAgain")}</p>
        <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-gold/40 px-3 text-gold hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50">
            <RotateCw aria-hidden="true" className={`size-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} />
            {t("controls.checkNow")}
        </button>
    </section>;
}
