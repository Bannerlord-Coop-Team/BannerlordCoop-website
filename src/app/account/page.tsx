import { AccountStatusSync } from "@/app/account/AccountStatusSync";
import { DisconnectAccount } from "@/app/account/DisconnectAccount";
import { linkDiscordAccount, linkPatreonAccount, disconnectDiscordAccount, disconnectPatreonAccount } from "@/app/account/actions";
import { accountDisplayName, discordDisplayName } from "@/app/lib/auth/account-display";
import { ArrowRight, Check, UserRound } from "lucide-react";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { LoadingButton } from "@/app/components/ui/LoadingButton";
import type { AccountStatus } from "@/app/lib/hosting/membership-onboarding";
import { getWebsiteAccountStatus } from "@/app/lib/hosting/website-account-status";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { getLocale, getMessages, getTranslations } from "@/app/lib/localization/server";
import type { Translator } from "@/app/lib/localization/types";

/** Resolves the account title from the explicitly selected request locale. */
export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getTranslations("account");
    return { title: t("metadata.title") };
}
export const dynamic = "force-dynamic";
/** Renders authenticated account status and localized connection controls without changing account authority. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ patreon?: string; discord?: string }> }) {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/account");
    const locale = await getLocale();
    const { t } = await getTranslations("account", locale);
    const messages = await getMessages(["account"], locale);
    const params = await searchParams;
    let status: AccountStatus | null = null;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user.id === user.id) {
            status = await getWebsiteAccountStatus(user.id, session.access_token);
        }
    } catch { /* Query parameters never establish current link state. */ }

    // This dynamic server page takes one request-time snapshot; it is not a client render clock.
    // eslint-disable-next-line react-hooks/purity
    const checkedAt = Date.now();
    const accountName = accountDisplayName(user, t("defaultName"));
    const discordName = discordDisplayName(user);
    const discordIdentity = user.identities?.find(identity => identity.provider === "discord");
    const hasOtherSignIn = user.identities?.some(identity => identity.provider !== "discord") ?? false;
    const needsStatusUpdates = !status || status.membership.linked && ["pending", "unavailable"].includes(status.membership.sync) || Object.values(params).some(Boolean);
    const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-gold px-5 py-3 text-sm font-semibold text-background transition-colors hover:bg-gold/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background";
    const secondaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-white/20 px-4 py-2 text-sm text-foreground transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";

    return <LocalizationProvider locale={locale} messages={messages}><div className="flex min-h-svh flex-col bg-background text-foreground"><Navbar /><main className="flex-1"><section className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16" aria-labelledby="account-heading">
        <AccountStatusSync key={user.id} pending={needsStatusUpdates} />
        <h1 id="account-heading" className="font-display text-4xl font-semibold">{t("heading")}</h1>
        <div className="mt-6 flex min-w-0 items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold"><UserRound aria-hidden="true" className="size-7" /></span>
            <div className="min-w-0"><p className="break-words font-display text-2xl font-semibold">{accountName}</p><p className="mt-1 text-sm leading-6 text-foreground-muted">{t("intro")}</p></div>
        </div>
        {!status && <p role="alert" className="mt-6 border-l-2 border-gold bg-gold/10 p-4 text-sm">{t("status.unavailable")}</p>}
        {(params.patreon === "rate_limited" || params.discord === "rate_limited") && <p role="alert" className="mt-4">{t("error.rateLimited")}</p>}
        {[params.patreon, params.discord].includes("retry") && <p role="alert" className="mt-4">{t("error.retry")}</p>}
        {params.discord === "last_identity" && <p role="alert" className="mt-4 text-sm">{t("error.lastIdentity")}</p>}
        {params.discord === "disconnect_error" && <p role="alert" className="mt-4 text-sm">{t("error.discordDisconnect")}</p>}
        {params.patreon === "disconnect_error" && <p role="alert" className="mt-4 text-sm">{t("error.patreonDisconnect")}</p>}
        {params.discord === "repair" && <p role="alert" className="mt-4">{t("error.discordRepair")}</p>}
        {["error", "confirm_error", "cancelled"].includes(params.patreon ?? "") && <p role="alert" className="mt-4">{t("error.patreonAuthorization")}</p>}
        <section id="link-account" className="mt-10" aria-labelledby="connections-heading">
            <h2 id="connections-heading" className="font-display text-2xl font-semibold">{t("connections.heading")}</h2>
            <div className="mt-4 divide-y divide-white/10 rounded-sm border border-white/10 bg-surface">
                <section className="p-5 sm:p-6" aria-labelledby="discord-heading">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="discord-heading" className="font-semibold">Discord</h3><ConnectionBadge connected={status?.hasDiscord} t={t} /></div>
                    <p className="mt-3 break-words text-sm leading-6 text-foreground-muted">{status?.hasDiscord ? discordName ?? t("discord.connected") : t("discord.optional")}</p>
                    {status?.hasDiscord && <DisconnectAccount provider="Discord" action={disconnectDiscordAccount.bind(null, user.id, discordIdentity?.identity_id ?? "")} disabledReason={!discordIdentity?.identity_id ? t("discord.identityUnavailable") : !hasOtherSignIn ? t("error.lastIdentity") : undefined} />}

                    {status && !status.hasDiscord && (
                        <form action={linkDiscordAccount} className="mt-4">
                            <input type="hidden" name="returnPath" value="/account" />
                            <LoadingButton
                                pendingText={t("discord.connectPending")}
                                className={primaryButton}
                            >
                                {t("discord.connect")}
                            </LoadingButton>
                        </form>
                    )}</section>
                <section className="p-5 sm:p-6" aria-labelledby="patreon-heading">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="patreon-heading" className="font-semibold">Patreon</h3><ConnectionBadge connected={status?.membership.linked} t={t} /></div>
                    <p className="mt-3 text-sm leading-6 text-foreground-muted">{status?.membership.linked ? t("patreon.linked") : t("patreon.benefits")}</p>
                    {status?.membership.linked && <div className="mt-3 space-y-2 text-sm leading-6 text-foreground-muted">
                        <p role="status">{status.membership.verification === "qualifying" && status.membership.validUntil && Date.parse(status.membership.validUntil) > checkedAt ? t("membership.verified") : status.membership.verification === "nonqualifying" ? t("membership.nonqualifying") : status.membership.verification === "review_required" ? t("membership.reviewRequired") : t("membership.verifyRequired")}</p>
                        {status.membership.sync === "pending" && <p role="status">{t("membership.syncPending")}</p>}
                        {status.membership.sync === "unavailable" && <p role="status">{t("membership.syncUnavailable")}</p>}
                        <p>{t("membership.expiry")}</p>
                    </div>}

                    {status && (
                        <form action={linkPatreonAccount} className="mt-4">
                            <input type="hidden" name="returnPath" value="/account" />
                            <LoadingButton
                                pendingText={
                                    status.membership.linked
                                        ? t("patreon.verifyPending")
                                        : t("patreon.connectPending")
                                }
                                className={primaryButton}
                            >
                                {status.membership.linked
                                    ? t("patreon.verify")
                                    : t("patreon.connect")}
                            </LoadingButton>
                        </form>
                    )}
                    {status?.membership.linked && <DisconnectAccount provider="Patreon" action={disconnectPatreonAccount.bind(null, user.id)} />}
                </section>
            </div>
        </section>
        <section className="mt-8 rounded-sm border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="servers-heading">
            <h2 id="servers-heading" className="font-display text-2xl font-semibold">{t("servers.heading")}</h2>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("servers.description")}</p>
            <Link href="/servers" prefetch={false} className={`${secondaryButton} mt-4`}>{t("servers.link")} <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </section>
    </section></main><Footer /></div></LocalizationProvider>;
}

/** Shows translated connection state while retaining the authoritative tri-state status. */
function ConnectionBadge({ connected, t }: { connected: boolean | undefined; t: Translator["t"] }) {
    return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${connected ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-white/15 text-foreground-muted"}`}>
        {connected && <Check aria-hidden="true" className="size-3.5" />}{connected === undefined ? t("badge.unavailable") : connected ? t("badge.connected") : t("badge.unlinked")}
    </span>;
}
