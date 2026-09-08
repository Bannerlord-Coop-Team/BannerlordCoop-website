import { cancelPatreonCompletion, completePatreonAccount, confirmDiscordAccount, linkDiscordAccount, linkPatreonAccount, unlinkPatreonAccount } from "@/app/account/actions";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { parseAccountStatus, type AccountStatus } from "@/app/lib/hosting/membership-onboarding";
import { LINK_COOKIE, PATREON_COOKIE } from "@/app/lib/auth/account-link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
export const metadata: Metadata = { title: "Account | Bannerlord Coop" };
export const dynamic = "force-dynamic";
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ patreon?: string; discord?: string }> }) {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/account");
    const params = await searchParams;
    const jar = await cookies();
    let status: AccountStatus | null = null;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user.id === user.id) {
            const result = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "status" } });
            if (!result.error) status = parseAccountStatus(result.data, user.id);
        }
    } catch { /* Query parameters never establish current link state. */ }
    const patreonConfirmation = jar.has(PATREON_COOKIE);
    const discordConfirmation = jar.has(LINK_COOKIE) && params.discord === "confirm";
    return <><Navbar /><main className="min-h-[70svh] bg-background"><section className="site-container py-16 sm:py-20" aria-labelledby="account-heading">
        <h1 id="account-heading" className="font-display text-4xl font-semibold">Account</h1>
        <p className="mt-5 text-sm">Stay signed in to this same website account while connecting providers. Separate Discord/website accounts require support-assisted repair; there is no automatic merge, email matching or server ownership transfer.</p>
        <p role="status" className="mt-5">{status ? `Discord: ${status.hasDiscord ? "connected" : "not connected"}. Patreon: ${status.membership.linked ? "linked" : "not linked"}. Verification: ${status.membership.verification}. Sync: ${status.membership.sync}.` : "Current account link status is unavailable. Retry status; do not infer success from the address bar."}</p>
        {params.discord === "repair" && <p role="alert" className="mt-4">Discord linking could not be confirmed. Manual linking may be disabled, your session changed, the request expired, or this Discord belongs to another account. Sign in to the original account and restart, or contact support. We never substitute sign-in for linking.</p>}
        {["error", "confirm_error", "cancelled"].includes(params.patreon ?? "") && <p role="alert" className="mt-4">Patreon authorization was cancelled or could not be confirmed. If a confirmation is pending, retry that same confirmation before starting again. A Patreon account can belong to only one website account.</p>}
        {patreonConfirmation && <div className="mt-6 border border-gold/30 p-5"><p>Confirm linking the authorized Patreon identity to your currently signed-in website account. Completion checks the initiating account again. If the response is lost, retry this same confirmation.</p><form action={completePatreonAccount}><button className="mt-3 underline" type="submit">Confirm Patreon link and verification</button></form><form action={cancelPatreonCompletion}><button className="mt-3 underline" type="submit">Cancel pending confirmation</button></form></div>}
        {discordConfirmation && <form action={confirmDiscordAccount} className="mt-6"><p>Confirm returning to the same account with its current authoritative Discord identity.</p><button type="submit" className="mt-3 underline">Confirm Discord connection</button></form>}
        <div id="link-account" className="mt-8 space-y-5">
            {status && !status.hasDiscord && <form action={linkDiscordAccount}><input type="hidden" name="returnPath" value="/account" /><p>Confirm that you want to connect Discord to this signed-in account.</p><button type="submit" className="mt-3 underline">Confirm and connect Discord</button></form>}
            {!patreonConfirmation && <form action={linkPatreonAccount}><input type="hidden" name="returnPath" value="/account" /><button type="submit" className="underline">{status?.membership.linked ? "Check again with Patreon authorization" : "Link Patreon account"}</button></form>}
            {status?.membership.linked && <form action={unlinkPatreonAccount}><p>Unlink removes only future membership allocation evidence, not existing servers or administrative grants.</p><button type="submit" className="mt-3 underline">Confirm unlink Patreon</button></form>}
            <Link href="/account" className="block underline">Refresh status (no new Patreon authorization)</Link>
            <Link href="/servers" className="block underline">Continue to Servers / manage existing servers</Link>
        </div>
        <p className="mt-6 text-sm text-foreground-muted">Membership verification requires explicit authorization and lasts at most 24 hours for new allocation. It does not prove a settled payment and does not run unattended. Unknown or expired evidence never starts automatic Stop, deletion or a grace countdown. Adequate administrative grants bypass membership steps.</p>
    </section></main><Footer /></>;
}
