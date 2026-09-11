import { AccountStatusSync } from "@/app/account/AccountStatusSync";
import { DisconnectAccount } from "@/app/account/DisconnectAccount";
import { linkDiscordAccount, linkPatreonAccount, disconnectDiscordAccount, disconnectPatreonAccount } from "@/app/account/actions";
import { accountDisplayName, discordDisplayName } from "@/app/lib/auth/account-display";
import { ArrowRight, Check, UserRound } from "lucide-react";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import type { AccountStatus } from "@/app/lib/hosting/membership-onboarding";
import { getWebsiteAccountStatus } from "@/app/lib/hosting/website-account-status";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
export const metadata: Metadata = { title: "Account | Bannerlord Coop" };
export const dynamic = "force-dynamic";
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ patreon?: string; discord?: string }> }) {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/account");
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
    const accountName = accountDisplayName(user);
    const discordName = discordDisplayName(user);
    const discordIdentity = user.identities?.find(identity => identity.provider === "discord");
    const hasOtherSignIn = user.identities?.some(identity => identity.provider !== "discord") ?? false;
    const needsStatusUpdates = !status || status.membership.linked && ["pending", "unavailable"].includes(status.membership.sync) || Object.values(params).some(Boolean);
    const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-gold px-5 py-3 text-sm font-semibold text-background transition-colors hover:bg-gold/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background";
    const secondaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-white/20 px-4 py-2 text-sm text-foreground transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";

    return <div className="flex min-h-svh flex-col bg-background text-foreground"><Navbar /><main className="flex-1"><section className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16" aria-labelledby="account-heading">
        <AccountStatusSync key={user.id} pending={needsStatusUpdates} />
        <h1 id="account-heading" className="font-display text-4xl font-semibold">Account</h1>
        <div className="mt-6 flex min-w-0 items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold"><UserRound aria-hidden="true" className="size-7" /></span>
            <div className="min-w-0"><p className="break-words font-display text-2xl font-semibold">{accountName}</p><p className="mt-1 text-sm leading-6 text-foreground-muted">Manage your connected accounts and membership.</p></div>
        </div>
        {!status && <p role="alert" className="mt-6 border-l-2 border-gold bg-gold/10 p-4 text-sm">Account status is temporarily unavailable. We’ll check again automatically.</p>}
        {(params.patreon === "rate_limited" || params.discord === "rate_limited") && <p role="alert" className="mt-4">Too many account changes or synchronization is still catching up. Wait for updated status before trying again. Authorization expires within ten minutes. Unlink and existing server management remain available.</p>}
        {[params.patreon, params.discord].includes("retry") && <p role="alert" className="mt-4">The account is busy. Check the updated connection status before trying again. A new authorization replaces unfinished attempts.</p>}
        {params.discord === "last_identity" && <p role="alert" className="mt-4 text-sm">Discord is your only sign-in method. Connect another sign-in method before disconnecting it.</p>}
        {params.discord === "disconnect_error" && <p role="alert" className="mt-4 text-sm">Discord could not be disconnected. Status updates automatically; try again once it is available. If the problem continues, contact support.</p>}
        {params.patreon === "disconnect_error" && <p role="alert" className="mt-4 text-sm">Patreon could not be disconnected. Status updates automatically; wait for the current status before trying again.</p>}
        {params.discord === "repair" && <p role="alert" className="mt-4">Discord linking could not be completed. Check your current connection below before trying again. Your session may have changed, the request expired, or Discord may belong to another account. We never substitute sign-in for linking.</p>}
        {["error", "confirm_error", "cancelled"].includes(params.patreon ?? "") && <p role="alert" className="mt-4">Patreon authorization was cancelled or could not be completed. Check your current connection below, then connect or verify again if needed. A Patreon account can belong to only one website account.</p>}
        <section id="link-account" className="mt-10" aria-labelledby="connections-heading">
            <h2 id="connections-heading" className="font-display text-2xl font-semibold">Connected accounts</h2>
            <div className="mt-4 divide-y divide-white/10 rounded-sm border border-white/10 bg-surface">
                <section className="p-5 sm:p-6" aria-labelledby="discord-heading">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="discord-heading" className="font-semibold">Discord</h3><ConnectionBadge connected={status?.hasDiscord} /></div>
                    <p className="mt-3 break-words text-sm leading-6 text-foreground-muted">{status?.hasDiscord ? discordName ?? "Your Discord account is connected." : "Connect Discord to this website account to set up a server."}</p>
                    {status?.hasDiscord && <DisconnectAccount provider="Discord" action={disconnectDiscordAccount.bind(null, user.id, discordIdentity?.identity_id ?? "")} disabledReason={!discordIdentity?.identity_id ? "Discord identity could not be confirmed. Waiting for updated account status." : !hasOtherSignIn ? "Discord is your only sign-in method. Connect another sign-in method before disconnecting it." : undefined} />}
                    {status && !status.hasDiscord && <form action={linkDiscordAccount} className="mt-4"><input type="hidden" name="returnPath" value="/account" /><button type="submit" className={primaryButton}>Confirm and connect Discord</button></form>}
                </section>
                <section className="p-5 sm:p-6" aria-labelledby="patreon-heading">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="patreon-heading" className="font-semibold">Patreon</h3><ConnectionBadge connected={status?.membership.linked} /></div>
                    <p className="mt-3 text-sm leading-6 text-foreground-muted">{status?.membership.linked ? "Your Patreon account is linked." : "Connect Patreon to check your membership benefits and server allowance."}</p>
                    {status?.membership.linked && <div className="mt-3 space-y-2 text-sm leading-6 text-foreground-muted">
                        <p role="status">{status.membership.verification === "qualifying" && status.membership.validUntil && Date.parse(status.membership.validUntil) > checkedAt ? "Membership verified." : status.membership.verification === "nonqualifying" ? "No eligible membership benefits were found." : status.membership.verification === "review_required" ? "Your membership needs review. Contact support before trying again." : "Verify your membership before creating a new server."}{status.membership.sync === "pending" ? " Your server allowance is updating." : status.membership.sync === "unavailable" ? " Your server allowance could not be checked." : ""}</p>
                        <p>You may need to verify your membership again before creating a new server. Existing servers aren’t automatically stopped when verification expires.</p>
                    </div>}
                    {status && <form action={linkPatreonAccount} className="mt-4"><input type="hidden" name="returnPath" value="/account" /><button type="submit" className={primaryButton}>{status.membership.linked ? "Verify with Patreon" : "Connect Patreon"}</button></form>}
                    {status?.membership.linked && <DisconnectAccount provider="Patreon" action={disconnectPatreonAccount.bind(null, user.id)} />}
                </section>
            </div>
        </section>
        <section className="mt-8 rounded-sm border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="servers-heading">
            <h2 id="servers-heading" className="font-display text-2xl font-semibold">Your servers</h2>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">View and manage your existing servers.</p>
            <Link href="/servers" prefetch={false} className={`${secondaryButton} mt-4`}>My Servers <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </section>
    </section></main><Footer /></div>;
}

function ConnectionBadge({ connected }: { connected: boolean | undefined }) {
    return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${connected ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-white/15 text-foreground-muted"}`}>
        {connected && <Check aria-hidden="true" className="size-3.5" />}{connected === undefined ? "Unavailable" : connected ? "Connected" : "Not linked"}
    </span>;
}
