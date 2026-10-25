import { LocalizationProvider } from "@/app/lib/localization/client";
import { getLocale, getMessages, getTranslations, getOpenGraphLocale } from "@/app/lib/localization/server";
import { Hero } from "@/app/components/home/Hero";
import { CommunityStats } from "@/app/components/home/community/CommunityStats";
import { CoopFeatures } from "@/app/components/home/features/CampaignFeatures";
import { Roadmap } from "@/app/components/home/roadmap/Roadmap";
import { AboutProject } from "@/app/components/home/idea/AboutProject";
import { CommunityMedia } from "@/app/components/home/media/CommunityMedia";
import { DownloadSection } from "@/app/components/home/modulesection/DownloadSection";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { getNetworkStats } from "@/app/lib/network-stats";
import type {Metadata} from "next";
import { Suspense } from "react";

// Resolves homepage metadata from the explicit request locale.
export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getTranslations("home");
    return {
        description: t("metadata.description"),
        alternates: {
            canonical: "/",
        },

        openGraph: {
            type: "website",
            locale: await getOpenGraphLocale(),
            url: "/",
            title: "Bannerlord Co-op",
            description:
                t("metadata.description"),
            images: [
                {
                    url: "/images/banner.png",
                    width: 1200,
                    height: 630,
                    alt: "Bannerlord Co-op",
                },
            ],
        },

        twitter: {
            card: "summary_large_image",
            title: "Bannerlord Co-op",
            description:
                t("metadata.description"),
            images: ["/images/banner.png"],
        },
    };
}

async function NetworkStatistics() {
    const stats = await getNetworkStats();
    return <CommunityStats {...stats} />;
}

// Delivers home messages to interactive leaves alongside server-rendered sections.
export default async function Home() {
    const locale = await getLocale();
    const messages = await getMessages(["home"], locale);

    return (
        <LocalizationProvider locale={locale} messages={messages}>
            <Navbar />
            <main>
                <Hero />
                <Suspense fallback={<CommunityStats loading playersOnline={null} dedicatedServersCount={null} battlesFoughtTotal={null} totalDownloads={null} />}>
                    <NetworkStatistics />
                </Suspense>
                <CommunityMedia />
                <CoopFeatures />
                <Roadmap />
                <AboutProject />
                <DownloadSection />
            </main>
            <Footer />
        </LocalizationProvider>
    );
}
