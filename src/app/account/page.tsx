import { resolveAccountLink, completePatreonAccount, confirmDiscordAccount, linkDiscordAccount, linkPatreonAccount, unlinkPatreonAccount } from "@/app/account/actions";
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

    return <><Navbar /><main className="min-h-[70svh] bg-background"><section className="site-container py-16 sm:py-20" aria-labelledby="account-heading">
        <h1 id="account-heading" className="font-display text-4xl font-semibold">Account</h1>
        <p className="mt-5 text-sm">Stay signed in to this same website account while connecting providers. Separate Discord/website accounts require support-assisted repair; there is no automatic merge, email matching or server ownership transfer.</p>
        <p role="status" className="mt-5">{status ? `Discord: ${status.hasDiscord ? "connected" : "not connected"}. Patreon: ${status.membership.linked ? "linked" : "not linked"}. Verification: ${status.membership.verification}. Sync: ${status.membership.sync}.` : "Current account link status is unavailable. Retry status; do not infer success from the address bar."}</p>
        {(params.patreon === "rate_limited" || params.discord === "rate_limited") && <p role="alert" className="mt-4">Too many account changes or synchronization is still catching up. Refresh status before retrying; there is no guaranteed wait time. Authorization expires within ten minutes and is never extended by retrying. Resolve the original attempt below before starting again. Unlink and existing server management remain available.</p>}
        {[params.patreon, params.discord, params.recovery].includes("retry") && <p role="alert" className="mt-4">The account is busy. No refused database statement was applied. Keep this same account and retained attempt; refresh status and explicitly retry the same confirmation or resolution. Do not start a replacement authorization while its outcome is unknown. A consumed provider callback may require resolving the retained attempt before explicitly starting again. There is no guaranteed wait time.</p>}
        {params.discord === "repair" && <p role="alert" className="mt-4">Discord linking could not be confirmed. Manual linking may be disabled, your session changed, the request expired, or this Discord belongs to another account. Return to the original account and refresh the retained attempt below. Missing server-side linking configuration requires operator repair; do not assume Auth connection confirms this attempt. We never substitute sign-in for linking.</p>}
        {["error", "confirm_error", "cancelled"].includes(params.patreon ?? "") && <p role="alert" className="mt-4">Patreon authorization was cancelled or could not be confirmed. If a confirmation is pending, retry that same confirmation before starting again. A Patreon account can belong to only one website account.</p>}
        {params.recovery === "unavailable" && <p role="alert">The operation could not be resolved. Keep this attempt and refresh status; do not start another authorization.</p>}
        {(["discord", "patreon"] as const).map(provider => {
            const pending = recovery[provider]; const label = provider === "discord" ? "Discord" : "Patreon";
            if (!pending) return <p key={provider} role="alert">{label} confirmation recovery is unavailable. Refresh status before starting another attempt.</p>;
            if (pending.state === "none") return null;
            return <div key={provider} className="mt-6 border border-gold/30 p-5" aria-label={`${label} confirmation recovery`}>
                {pending.state === "live" && <><p>{label} has an uncommitted attempt. {pending.confirmable ? "You can retry this exact confirmation while its authority remains valid." : "This attempt may be superseded, or its callback verification/browser authority is unavailable. Current Auth connection is not proof this attempt committed; a valid connection remains usable independently. Refresh status, or explicitly cancel this attempt before starting again."}</p>
                    {pending.confirmable && <form action={provider === "discord" ? confirmDiscordAccount : completePatreonAccount}><button className="mt-3 underline" type="submit">{provider === "discord" ? "Confirm Discord connection" : "Confirm Patreon link and verification"}</button></form>}</>}
                {pending.state === "expired" && <p>This {label} attempt expired without committing. Resolve it below before explicitly starting a new authorization. Any current Discord Auth connection remains connected and usable for Servers/Patreon; this expired attempt is not reported as confirmed.</p>}
                {["committed", "resolved"].includes(pending.state) && <p>This exact {label} attempt committed. Recover its original result below; this does not restore any subsequently unlinked or changed binding.</p>}
                {["historical", "retired"].includes(pending.state) && <p>This historical Discord attempt is not your current Auth identity. {pending.state === "retired" ? "Its recovery reference is already acknowledged; you may explicitly connect again if Auth is unlinked." : "Retire its reference before explicitly connecting again if Auth is unlinked."} This does not recover a current confirmation, restore the old identity or grant membership. Any current Auth connection remains usable independently.</p>}
                <form action={resolveAccountLink}><input type="hidden" name="provider" value={provider} /><input type="hidden" name="operationId" value={pending.operationId} /><button className="mt-3 underline" type="submit">{["historical", "retired"].includes(pending.state) ? "Retire historical Discord reference" : ["committed", "resolved"].includes(pending.state) ? `Recover ${label} result` : pending.state === "expired" ? `Resolve expired ${label} attempt` : `Cancel pending ${label} attempt`}</button></form>
            </div>;
        })}
        <div id="link-account" className="mt-8 space-y-5">
            {status && !status.hasDiscord && (recovery.discord?.state === "none" || recovery.discord?.state === "retired") && <form action={linkDiscordAccount}><input type="hidden" name="returnPath" value="/account" /><p>Confirm that you want to connect Discord to this signed-in account.</p><button type="submit" className="mt-3 underline">Confirm and connect Discord</button></form>}
            {(recovery.patreon?.state === "none" || recovery.patreon?.state === "resolved") && <form action={linkPatreonAccount}><input type="hidden" name="returnPath" value="/account" /><button type="submit" className="underline">{status?.membership.linked ? "Check again with Patreon authorization" : "Link Patreon account"}</button></form>}
            {status?.membership.linked && <form action={unlinkPatreonAccount}><p>Unlink removes only future membership allocation evidence, not existing servers or administrative grants.</p><button type="submit" className="mt-3 underline">Confirm unlink Patreon</button></form>}
            <Link href="/account" prefetch={false} className="block underline">Refresh status (no new Patreon authorization)</Link>
            <Link href="/servers" prefetch={false} className="block underline">Continue to Servers / manage existing servers</Link>
        </div>
        <p className="mt-6 text-sm text-foreground-muted">Membership verification requires explicit authorization and lasts at most 24 hours for new allocation. It does not prove a settled payment and does not run unattended. Unknown or expired evidence never starts automatic Stop, deletion or a grace countdown. Adequate administrative grants bypass membership steps.</p>
    </section></main><Footer /></>;
}
