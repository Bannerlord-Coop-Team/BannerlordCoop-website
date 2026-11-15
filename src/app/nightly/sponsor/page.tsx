import { NightlyCard } from "@/app/components/nightly/NightlyCard";
import { NightlyError } from "@/app/components/nightly/NightlyStatus";
import { SponsorLogin, SponsorPortal } from "@/app/components/nightly/SponsorPortal";
import { primaryButtonClass } from "@/app/components/nightly/styles";
import { readSponsorSession, SPONSOR_COOKIE } from "@/app/lib/nightly/cookies";
import { loadPortalView } from "@/app/lib/nightly/flows";
import { getNightlyClient } from "@/app/lib/nightly/server";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSponsorCode, removeSponsoredSeat } from "./actions";

export const metadata: Metadata = { title: "Share nightlies with friends", robots: { index: false, follow: false } };

type SponsorPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Sponsor portal: login prompt without a session, otherwise the seat list from `/sponsor/portal`. */
export default async function SponsorPage({ searchParams }: SponsorPageProps) {
    const session = readSponsorSession((await cookies()).get(SPONSOR_COOKIE)?.value);
    const alreadyCleared = (await searchParams).session === "expired";
    const view = await loadPortalView(getNightlyClient(), session, alreadyCleared);
    // Pages cannot write cookies, so an expired session is cleared by the logout route handler.
    if (view.kind === "clear-session") redirect("/nightly/sponsor/logout");
    if (view.kind === "login") {
        return <NightlyCard eyebrow="Nightly access portal"><SponsorLogin expired={view.expired} /></NightlyCard>;
    }
    if (view.kind === "ineligible") {
        return (
            <NightlyCard eyebrow="Nightly access portal">
                <NightlyError message={view.message}>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-foreground-muted">
                        Your sponsored accounts only keep access while you hold a qualifying role. Once it is restored, sign in again.
                    </p>
                    <div className="mt-6">
                        <a className={primaryButtonClass} href="/nightly/sponsor/login">Sign in again <span aria-hidden="true">&rarr;</span></a>
                    </div>
                </NightlyError>
            </NightlyCard>
        );
    }
    if (view.kind === "error") {
        return <NightlyCard eyebrow="Nightly access portal"><NightlyError message={view.message} /></NightlyCard>;
    }
    return (
        <NightlyCard eyebrow="Nightly access portal" wide>
            <SponsorPortal data={view.data} createCode={createSponsorCode} removeSeat={removeSponsoredSeat} />
        </NightlyCard>
    );
}
