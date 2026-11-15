import { NightlyCard } from "@/app/components/nightly/NightlyCard";
import { SponsorCodeHelp } from "@/app/components/nightly/NightlyNotes";
import { NightlyError } from "@/app/components/nightly/NightlyStatus";
import { nightlyErrorView } from "@/app/lib/nightly/messages";
import { readErrorQuery, type PageSearchParams } from "@/app/lib/nightly/query-flags";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Access unavailable", robots: { index: false, follow: false } };

type ErrorPageProps = { searchParams: Promise<PageSearchParams> };

/** Shows the mapped message for a failed nightly step; query values only select canned copy, never render. */
export default async function NightlyErrorPage({ searchParams }: ErrorPageProps) {
    const { context, code } = readErrorQuery(await searchParams);
    const view = nightlyErrorView(context, code);
    return (
        <NightlyCard eyebrow="Nightly access">
            <NightlyError message={view.message}>
                {view.help === "sponsor-code" && <SponsorCodeHelp />}
            </NightlyError>
        </NightlyCard>
    );
}
