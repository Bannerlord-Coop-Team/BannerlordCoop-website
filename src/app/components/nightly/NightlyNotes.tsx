import { WINDOWS_INSTALLER_FILENAME, WINDOWS_INSTALLER_URL } from "@/app/lib/nightly/links";
import { QUALIFYING_ROLES_TEXT } from "../../../../supabase/functions/_shared/nightly/policy";
import type { ReactNode } from "react";
import { primaryButtonClass, secondaryButtonClass } from "./styles";

/** Renders a gold-ruled callout with a short label and body. */
export function SupportNote({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="mt-8 grid gap-2 border-l-2 border-gold bg-gold/[0.06] px-5 py-4 text-sm leading-6 sm:grid-cols-[minmax(8rem,0.55fr)_1fr] sm:gap-5">
            <strong className="font-label text-xs font-semibold uppercase tracking-[0.14em] text-gold">{title}</strong>
            <span className="text-foreground-muted">{children}</span>
        </div>
    );
}

/** Renders a bordered help panel with an optional action. */
function HelpPanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
    return (
        <div className="mt-8 flex flex-col gap-4 border border-gold/25 bg-gold/[0.055] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <strong className="block font-label text-xs font-semibold uppercase tracking-[0.14em] text-gold">{title}</strong>
                <p className="mt-2 max-w-md text-sm leading-6 text-foreground-muted">{children}</p>
            </div>
            {action}
        </div>
    );
}

/** Explains how sponsor codes are redeemed, for people who reached a sponsor-only page without a role. */
export function SponsorCodeHelp() {
    return (
        <HelpPanel
            title="Have a sponsor code?"
            action={(
                <a className={`${secondaryButtonClass} shrink-0`} href={WINDOWS_INSTALLER_URL} download={WINDOWS_INSTALLER_FILENAME}>
                    Download installer <span aria-hidden="true">&darr;</span>
                </a>
            )}
        >
            Codes are redeemed through the installer. Run it, sign in with your own Discord account, then enter the code on
            the &ldquo;One more step&rdquo; page.
        </HelpPanel>
    );
}

/** Tells a previously sponsored user that their sponsor lost access and a new code is needed. */
export function PreviousSponsorRevokedHelp() {
    return (
        <HelpPanel title="Previous sponsor access ended">
            The friend who sponsored this Discord account no longer has a qualifying {QUALIFYING_ROLES_TEXT} role. Enter a new
            sponsor code below.
        </HelpPanel>
    );
}

/** Explains that sponsored seats follow the sponsor's role and offers to sign in again once it is restored. */
export function SponsorIneligibleHelp() {
    return (
        <>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-foreground-muted">
                Your sponsored accounts only keep access while you hold a qualifying role. Once it is restored, sign in again.
            </p>
            <div className="mt-6">
                <a className={primaryButtonClass} href="/nightly/sponsor/login">Sign in again <span aria-hidden="true">&rarr;</span></a>
            </div>
        </>
    );
}
