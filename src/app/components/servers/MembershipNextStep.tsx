"use client";

import { useTranslations } from "@/app/lib/localization/client";
import Link from "next/link";
import { linkPatreonAccount } from "@/app/account/actions";
import type { WebsiteOnboardingSummary } from "@/app/lib/hosting/membership-onboarding";

/** Presents the next membership step without changing eligibility or authorization actions. */
export function MembershipNextStep({ summary }: { summary: WebsiteOnboardingSummary }) {
    const { t } = useTranslations("servers");
    return <section className="mt-7 border border-gold/30 bg-surface p-5" aria-label={t("membership.label")}>
        <p role="status">{t(`membership.status.${summary.status}`)}</p>
        {summary.nextAction === "confirm_account" && <Link className="mt-3 block underline" href="/account">{t("membership.confirm")}</Link>}
        {summary.nextAction === "sign_in" && <Link href="/login?next=/servers">{t("membership.signIn")}</Link>}
        {["connect_patreon", "check_again", "subscribe_or_upgrade"].includes(summary.nextAction) && <form action={linkPatreonAccount}><input type="hidden" name="returnPath" value="/servers" /><button className="mt-3 underline" type="submit">{summary.nextAction === "connect_patreon" ? t("membership.connect") : t("membership.checkAgain")}</button></form>}
        {summary.nextAction === "subscribe_or_upgrade" && <a href="https://www.patreon.com/" className="mt-3 block underline" rel="noreferrer">{t("membership.openPatreon")}</a>}
        {["repair_account", "contact_support"].includes(summary.nextAction) && <Link className="mt-3 block underline" href="/account">{t("membership.repair")}</Link>}
        <p className="mt-3 text-sm text-foreground-muted">{t("membership.independence")}</p>
    </section>;
}
