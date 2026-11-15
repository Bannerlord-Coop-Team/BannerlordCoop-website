import { NightlyCard } from "@/app/components/nightly/NightlyCard";
import { SponsorCodeHelp } from "@/app/components/nightly/NightlyNotes";
import { NightlyError } from "@/app/components/nightly/NightlyStatus";
import { GENERIC_ERROR_MESSAGE, nightlyErrorView, parseErrorContext } from "@/app/lib/nightly/messages";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Access unavailable", robots: { index: false, follow: false } };

type ErrorPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Shows the mapped message for a failed nightly step; query values only select canned copy, never render. */
export default async function NightlyErrorPage({ searchParams }: ErrorPageProps) {
    const params = await searchParams;
    const context = parseErrorContext(typeof params.context === "string" ? params.context : undefined);
    const code = typeof params.code === "string" ? params.code : "";
    const view = context === null ? { message: GENERIC_ERROR_MESSAGE, help: null } : nightlyErrorView(context, code);
    return (
        <NightlyCard eyebrow="Nightly access">
            <NightlyError message={view.message}>
                {view.help === "sponsor-code" && <SponsorCodeHelp />}
            </NightlyError>
        </NightlyCard>
    );
}
