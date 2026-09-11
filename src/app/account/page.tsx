import { AccountStatusSync } from "@/app/account/AccountStatusSync";
import { DisconnectAccount } from "@/app/account/DisconnectAccount";
import { PatreonAutoCompletion } from "@/app/account/PatreonAutoCompletion";
import { automaticallyCompletePatreonAccount, resolveAccountLink, completePatreonAccount, confirmDiscordAccount, linkDiscordAccount, linkPatreonAccount, disconnectDiscordAccount, disconnectPatreonAccount } from "@/app/account/actions";
import { accountDisplayName, discordDisplayName } from "@/app/lib/auth/account-display";
import { ArrowRight, Check, UserRound } from "lucide-react";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import type { AccountStatus } from "@/app/lib/hosting/membership-onboarding";
import { getWebsiteAccountStatus } from "@/app/lib/hosting/website-account-status";
import { parseLinkRecovery, type LinkRecovery } from "@/app/lib/auth/link-recovery";
import { LINK_COOKIE, PATREON_COOKIE } from "@/app/lib/auth/account-link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
export const metadata: Metadata = { title: "Account | Bannerlord Coop" };
export const dynamic = "force-dynamic";
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ patreon?: string; discord?: string; recovery?: string }> }) {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/account");
    const params = await searchParams;
    const jar = await cookies();
    let status: AccountStatus | null = null;
    const recovery: Record<"discord" | "patreon", LinkRecovery | null> = { discord: null, patreon: null };
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user.id === user.id) {
            status = await getWebsiteAccountStatus(user.id, session.access_token);
            for (const provider of ["discord", "patreon"] as const) {
                const token = jar.get(provider === "discord" ? LINK_COOKIE : PATREON_COOKIE)?.value;
                const pending = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "recovery-status", provider, token: token && /^[a-f0-9]{64}$/u.test(token) ? token : null } });
                if (!pending.error) recovery[provider] = parseLinkRecovery(pending.data, user.id, provider);
            }
        }
    } catch { /* Query parameters never establish current link state. */ }

    // This dynamic server page takes one request-time snapshot; it is not a client render clock.
    // eslint-disable-next-line react-hooks/purity
    const checkedAt = Date.now();
    const accountName = accountDisplayName(user);
    const discordName = discordDisplayName(user);
    const discordIdentity = user.identities?.find(identity => identity.provider === "discord");
    const hasOtherSignIn = user.identities?.some(identity => identity.provider !== "discord") ?? false;
    const needsStatusUpdates = !status || status.membership.linked && ["pending", "unavailable"].includes(status.membership.sync) || Object.values(recovery).some(pending => !pending || !["none", "retired", "resolved"].includes(pending.state)) || Object.values(params).some(Boolean);
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
        {(params.patreon === "rate_limited" || params.discord === "rate_limited") && <p role="alert" className="mt-4">Too many account changes or synchronization is still catching up. Refresh status before retrying; there is no guaranteed wait time. Authorization expires within ten minutes and is never extended by retrying. Resolve the original attempt below before starting again. Unlink and existing server management remain available.</p>}
        {[params.patreon, params.discord, params.recovery].includes("retry") && <p role="alert" className="mt-4">The account is busy. No refused database statement was applied. Keep this same account and retained attempt; refresh status and explicitly retry the same confirmation or resolution. Do not start a replacement authorization while its outcome is unknown. A consumed provider callback may require resolving the retained attempt before explicitly starting again. There is no guaranteed wait time.</p>}
        {params.discord === "last_identity" && <p role="alert" className="mt-4 text-sm">Discord is your only sign-in method. Connect another sign-in method before disconnecting it.</p>}
        {params.discord === "disconnect_error" && <p role="alert" className="mt-4 text-sm">Discord could not be disconnected. Status updates automatically; try again once it is available. If the problem continues, contact support.</p>}
        {params.patreon === "disconnect_error" && <p role="alert" className="mt-4 text-sm">Patreon could not be disconnected. Status updates automatically; wait for the current status before trying again.</p>}
        {params.discord === "repair" && <p role="alert" className="mt-4">Discord linking could not be confirmed. Manual linking may be disabled, your session changed, the request expired, or this Discord belongs to another account. Return to the original account and refresh the retained attempt below. Missing server-side linking configuration requires operator repair; do not assume Auth connection confirms this attempt. We never substitute sign-in for linking.</p>}
        {["error", "confirm_error", "cancelled"].includes(params.patreon ?? "") && <p role="alert" className="mt-4">Patreon authorization was cancelled or could not be confirmed. If a confirmation is pending, retry that same confirmation before starting again. A Patreon account can belong to only one website account.</p>}
        {params.recovery === "unavailable" && <p role="alert">The operation could not be resolved. Keep this attempt and refresh status; do not start another authorization.</p>}
        {(["discord", "patreon"] as const).map(provider => {
            const pending = recovery[provider]; const label = provider === "discord" ? "Discord" : "Patreon";
            if (!pending) return <p key={provider} role="alert">{label} confirmation recovery is unavailable. Refresh status before starting another attempt.</p>;
            if (pending.state === "none") return null;
            const autoComplete = provider === "patreon" && params.patreon === "confirm" && pending.state === "live" && pending.confirmable;
            return <div key={provider} className="mt-6 border border-gold/30 p-5" aria-label={`${label} confirmation recovery`}>
                {autoComplete && pending.operationId && <PatreonAutoCompletion key={`${user.id}:${pending.operationId}`} action={automaticallyCompletePatreonAccount.bind(null, user.id, pending.operationId)} />}
                {pending.state === "live" && !autoComplete && <><p>{label} has an uncommitted attempt. {pending.confirmable ? "You can retry this exact confirmation while its authority remains valid." : "This attempt may be superseded, or its callback verification/browser authority is unavailable. Current Auth connection is not proof this attempt committed; a valid connection remains usable independently. Refresh status, or explicitly cancel this attempt before starting again."}</p>
                    {pending.confirmable && <form action={provider === "discord" ? confirmDiscordAccount : completePatreonAccount}><button className="mt-3 underline" type="submit">{provider === "discord" ? "Confirm Discord connection" : "Retry connecting Patreon"}</button></form>}</>}
                {pending.state === "expired" && <p>This {label} attempt expired without committing. Resolve it below before explicitly starting a new authorization. Any current Discord Auth connection remains connected and usable for Servers/Patreon; this expired attempt is not reported as confirmed.</p>}
                {["committed", "resolved"].includes(pending.state) && <p>This exact {label} attempt committed. Recover its original result below; this does not restore any subsequently unlinked or changed binding.</p>}
                {["historical", "retired"].includes(pending.state) && <p>This historical Discord attempt is not your current Auth identity. {pending.state === "retired" ? "Its recovery reference is already acknowledged; you may explicitly connect again if Auth is unlinked." : "Retire its reference before explicitly connecting again if Auth is unlinked."} This does not recover a current confirmation, restore the old identity or grant membership. Any current Auth connection remains usable independently.</p>}
                <form action={resolveAccountLink}><input type="hidden" name="provider" value={provider} /><input type="hidden" name="operationId" value={pending.operationId} /><button className="mt-3 underline" type="submit">{["historical", "retired"].includes(pending.state) ? "Retire historical Discord reference" : ["committed", "resolved"].includes(pending.state) ? `Recover ${label} result` : pending.state === "expired" ? `Resolve expired ${label} attempt` : `Cancel pending ${label} attempt`}</button></form>
            </div>;
        })}
        <section id="link-account" className="mt-10" aria-labelledby="connections-heading">
            <h2 id="connections-heading" className="font-display text-2xl font-semibold">Connected accounts</h2>
            <div className="mt-4 divide-y divide-white/10 rounded-sm border border-white/10 bg-surface">
                <section className="p-5 sm:p-6" aria-labelledby="discord-heading">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="discord-heading" className="font-semibold">Discord</h3><ConnectionBadge connected={status?.hasDiscord} /></div>
                    <p className="mt-3 break-words text-sm leading-6 text-foreground-muted">{status?.hasDiscord ? discordName ?? "Your Discord account is connected." : "Connect Discord to this website account to set up a server."}</p>
                    {status?.hasDiscord && <DisconnectAccount provider="Discord" action={disconnectDiscordAccount.bind(null, user.id, discordIdentity?.identity_id ?? "")} disabledReason={!discordIdentity?.identity_id ? "Discord identity could not be confirmed. Waiting for updated account status." : !hasOtherSignIn ? "Discord is your only sign-in method. Connect another sign-in method before disconnecting it." : undefined} />}
                    {status && !status.hasDiscord && (recovery.discord?.state === "none" || recovery.discord?.state === "retired") && <form action={linkDiscordAccount} className="mt-4"><input type="hidden" name="returnPath" value="/account" /><button type="submit" className={primaryButton}>Confirm and connect Discord</button></form>}
                </section>
                <section className="p-5 sm:p-6" aria-labelledby="patreon-heading">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="patreon-heading" className="font-semibold">Patreon</h3><ConnectionBadge connected={status?.membership.linked} /></div>
                    <p className="mt-3 text-sm leading-6 text-foreground-muted">{status?.membership.linked ? "Your Patreon account is linked." : "Connect Patreon to check your membership benefits and server allowance."}</p>
                    {status?.membership.linked && <div className="mt-3 space-y-2 text-sm leading-6 text-foreground-muted">
                        <p role="status">{status.membership.verification === "qualifying" && status.membership.validUntil && Date.parse(status.membership.validUntil) > checkedAt ? "Membership verified." : status.membership.verification === "nonqualifying" ? "No eligible membership benefits were found." : status.membership.verification === "review_required" ? "Your membership needs review. Contact support before trying again." : "Verify your membership before creating a new server."}{status.membership.sync === "pending" ? " Your server allowance is updating." : status.membership.sync === "unavailable" ? " Your server allowance could not be checked." : ""}</p>
                        <p>You may need to verify your membership again before creating a new server. Existing servers aren’t automatically stopped when verification expires.</p>
                    </div>}
                    {status && (recovery.patreon?.state === "none" || recovery.patreon?.state === "resolved") && <form action={linkPatreonAccount} className="mt-4"><input type="hidden" name="returnPath" value="/account" /><button type="submit" className={primaryButton}>{status.membership.linked ? "Verify with Patreon" : "Connect Patreon"}</button></form>}
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
