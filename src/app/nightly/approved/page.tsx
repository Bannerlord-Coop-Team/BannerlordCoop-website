import { NightlyCard } from "@/app/components/nightly/NightlyCard";
import { NightlySuccess } from "@/app/components/nightly/NightlyStatus";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Access approved", robots: { index: false, follow: false } };

type ApprovedPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Confirms installer approval after the Discord callback or a sponsor claim. */
export default async function ApprovedPage({ searchParams }: ApprovedPageProps) {
    const sponsored = (await searchParams).via === "sponsor";
    return (
        <NightlyCard eyebrow="Nightly access">
            <NightlySuccess
                title={sponsored ? "Sponsored access approved" : "Access approved"}
                message="Return to the installer window. It will continue automatically."
            />
        </NightlyCard>
    );
}
