import { NightlyCard } from "@/app/components/nightly/NightlyCard";
import { PreviousSponsorRevokedHelp, SupportNote } from "@/app/components/nightly/NightlyNotes";
import { NightlyError } from "@/app/components/nightly/NightlyStatus";
import { SponsorClaimForm } from "@/app/components/nightly/SponsorClaimForm";
import { headingClass, ledeClass } from "@/app/components/nightly/styles";
import { CLAIM_COOKIE, decodeClaimContext } from "@/app/lib/nightly/cookies";
import { INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE } from "@/app/lib/nightly/messages";
import { QUALIFYING_ROLES_TEXT } from "../../../../supabase/functions/_shared/nightly/policy";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { claimSponsorSeat } from "./actions";

export const metadata: Metadata = { title: "Sponsor required", robots: { index: false, follow: false } };

/** Shows the sponsor-code form for a Discord account without a qualifying role (the `needs-sponsor` outcome). */
export default async function SponsorClaimPage() {
    const claim = decodeClaimContext((await cookies()).get(CLAIM_COOKIE)?.value);
    if (claim === null) {
        return (
            <NightlyCard eyebrow="Nightly installer">
                <NightlyError message={INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE} />
            </NightlyCard>
        );
    }
    return (
        <NightlyCard eyebrow="Nightly installer">
            <p className="mb-6 inline-flex items-center gap-2 border border-white/10 bg-white/[0.055] px-3 py-1.5 text-xs text-foreground-muted">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[#5f9565] shadow-[0_0_9px_rgba(95,149,101,0.55)]" />
                Signed in as <strong className="font-semibold text-foreground">{claim.username}</strong>
            </p>
            <h1 className={headingClass}>One more step to <span className="text-crimson">ride.</span></h1>
            <p className={ledeClass}>
                This Discord account does not currently have a qualifying {QUALIFYING_ROLES_TEXT} role.
            </p>
            {claim.previousSponsorRevoked && <PreviousSponsorRevokedHelp />}
            <div className="mb-5 mt-8 flex items-center gap-4 font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold after:h-px after:flex-1 after:bg-gold/25">
                Have a sponsor?
            </div>
            <SponsorClaimForm action={claimSponsorSeat} />
            <SupportNote title="Already eligible?">
                Make sure the correct Discord account has a qualifying {QUALIFYING_ROLES_TEXT} role (supporter roles come from
                the membership connected to that account), then restart the installer.
            </SupportNote>
        </NightlyCard>
    );
}
