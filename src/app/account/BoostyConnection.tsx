import type { Translator } from "@/app/lib/localization/types";
import type { BoostyStatus } from "../../../supabase/functions/_shared/boosty-account";

/** Renders the read-only Boosty status: linked through the account's email, or how to link. */
export function BoostyConnection({ status, t }: { status: Extract<BoostyStatus, { configured: true }>; t: Translator["t"] }) {
    const verification = status.verification === "qualifying" ? t("membership.verified") : status.verification === "nonqualifying" ? t("boosty.nonqualifying") : t("boosty.checking");
    return <section className="p-5 sm:p-6" aria-labelledby="boosty-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="boosty-heading" className="font-semibold">Boosty</h3>
            <span className="inline-flex items-center rounded-full border border-white/15 px-2.5 py-1 text-xs font-medium text-foreground-muted">{status.linked ? t("badge.connected") : t("badge.unlinked")}</span></div>
        <p role="status" className="mt-3 text-sm leading-6 text-foreground-muted">{status.linked ? `${t("boosty.linked")} ${verification}` : t("boosty.notFound")}</p>
    </section>;
}
