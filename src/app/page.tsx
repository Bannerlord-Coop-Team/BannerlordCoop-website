import { Hero } from "@/app/components/home/Hero";
import { CommunityStats } from "@/app/components/home/community/CommunityStats";
import { CoopFeatures } from "@/app/components/home/features/CampaignFeatures";
import { AboutProject } from "@/app/components/home/idea/AboutProject";
import { CommunityMedia } from "@/app/components/home/media/CommunityMedia";
import { DownloadSection } from "@/app/components/home/modulesection/DownloadSection";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { getNetworkStats } from "@/app/lib/network-stats";
import type {Metadata} from "next";

export const metadata: Metadata = {
    alternates: {
        canonical: "/",
    },

    openGraph: {
        url: "/",
        title: "Bannerlord Coop",
        description:
            "Play the Mount & Blade II: Bannerlord campaign with friends in a shared multiplayer world.",
    },

    twitter: {
        title: "Bannerlord Coop",
        description:
            "Play the Mount & Blade II: Bannerlord campaign with friends in a shared multiplayer world.",
    },
}

export default async function Home() {
    const {
        playersOnline,
        dedicatedServersCount,
        battlesFoughtTotal,
        totalDownloads,
    } = await getNetworkStats();

    return (
        <>
            <Navbar />
            <main>
                <Hero />
                <CommunityStats
                    playersOnline={playersOnline}
                    dedicatedServersCount={dedicatedServersCount}
                    battlesFoughtTotal={battlesFoughtTotal}
                    totalDownloads={totalDownloads}
                />
                <CommunityMedia />
                <CoopFeatures />
                <AboutProject />
                <DownloadSection />
            </main>
            <Footer />
        </>
    );
}
