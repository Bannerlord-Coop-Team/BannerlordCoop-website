import { DisconnectAccount } from "@/app/account/DisconnectAccount";
import { startBoostyLink, unlinkBoostyAccount } from "@/app/account/boosty-actions";
import { LoadingButton } from "@/app/components/ui/LoadingButton";
import type { Translator } from "@/app/lib/localization/types";
import type { BoostyLinkStatus } from "../../../supabase/functions/_shared/boosty-account";

type Configured = Extract<BoostyLinkStatus, { configured: true }>;

/** Renders the Boosty connection: link state, the DM code and its instructions, and unlink. */
export function BoostyConnection({ accountId, status, code, result, t, buttonClass }: {
    accountId: string; status: Configured; code: string | null; result: string | undefined;
    t: Translator["t"]; buttonClass: string;
}) {
    const showCode = !status.linked && status.pending?.matches === true && code !== null;
    return <section className="p-5 sm:p-6" aria-labelledby="boosty-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="boosty-heading" className="font-semibold">Boosty</h3>
            <span className="inline-flex items-center rounded-full border border-white/15 px-2.5 py-1 text-xs font-medium text-foreground-muted">{status.linked ? t("badge.connected") : t("badge.unlinked")}</span></div>
        {result === "error" && <p role="alert" className="mt-3 text-sm">{t("boosty.error")}</p>}
        {result === "disconnect_error" && <p role="alert" className="mt-3 text-sm">{t("boosty.disconnectError")}</p>}
        {!status.linked && status.outcome === "conflict" && <p role="alert" className="mt-3 text-sm">{t("boosty.conflict")}</p>}
        {!status.linked && status.outcome === "superseded" && <p role="alert" className="mt-3 text-sm">{t("boosty.superseded")}</p>}
        {status.linked
            ? <p role="status" className="mt-3 text-sm leading-6 text-foreground-muted">{t("boosty.linked")} {status.verification === "qualifying" ? t("membership.verified") : status.verification === "nonqualifying" ? t("boosty.nonqualifying") : t("boosty.checking")}</p>
            : <p className="mt-3 text-sm leading-6 text-foreground-muted">{t("boosty.benefits")}</p>}
        {showCode && <div className="mt-3 space-y-2 text-sm leading-6">
            <p>{t("boosty.codeLabel")}: <code className="select-all rounded-sm bg-black/30 px-2 py-1 font-mono text-base text-gold">{code}</code></p>
            <p className="text-foreground-muted">{t("boosty.codeInstructions", { creator: status.creatorName, expiresAt: `${status.pending!.expiresAt.slice(11, 16)} UTC` })}</p>
        </div>}
        {!status.linked && !showCode && status.pending !== null && <p className="mt-3 text-sm leading-6 text-foreground-muted">{t("boosty.codeWaiting")}</p>}
        {!status.linked && status.linkState !== "account_deleted" && <form action={startBoostyLink} className="mt-4">
            <LoadingButton pendingText={t("boosty.startPending")} className={buttonClass}>{status.pending !== null ? t("boosty.restart") : t("boosty.start")}</LoadingButton>
        </form>}
        {status.linked && <DisconnectAccount provider="Boosty" action={unlinkBoostyAccount.bind(null, accountId)} />}
    </section>;
}
