import { NightlyCard } from "@/app/components/nightly/NightlyCard";
import { SponsorIneligibleHelp } from "@/app/components/nightly/NightlyNotes";
import { NightlyError } from "@/app/components/nightly/NightlyStatus";
import { SponsorLogin, SponsorPortal } from "@/app/components/nightly/SponsorPortal";
import { readSponsorCookie } from "@/app/lib/nightly/cookies";
import { loadPortalView } from "@/app/lib/nightly/flows";
import { isSessionExpiredNotice, type PageSearchParams } from "@/app/lib/nightly/query-flags";
import { getNightlyClient } from "@/app/lib/nightly/server";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createSponsorCode, removeSponsoredSeat } from "./actions";

export const metadata: Metadata = { title: "Share nightlies with friends", robots: { index: false, follow: false } };

type SponsorPageProps = { searchParams: Promise<PageSearchParams> };

/** Sponsor portal: login prompt without a live session, otherwise the seat list from `/sponsor/portal`. */
export default async function SponsorPage({ searchParams }: SponsorPageProps) {
    const session = readSponsorCookie(await cookies());
    const view = await loadPortalView(getNightlyClient(), session, isSessionExpiredNotice(await searchParams));
    if (view.kind === "login") {
        return <NightlyCard eyebrow="Nightly access portal"><SponsorLogin expired={view.expired} /></NightlyCard>;
    }
    if (view.kind === "ineligible") {
        return (
            <NightlyCard eyebrow="Nightly access portal">
                <NightlyError message={view.message}><SponsorIneligibleHelp /></NightlyError>
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
