import { Hero } from "@/app/components/home/Hero";
import { CommunityStats } from "@/app/components/home/community/CommunityStats";
import { getCommunityServerData } from "@/app/components/home/community/server-data";
import { CoopFeatures } from "@/app/components/home/features/CampaignFeatures";
import { AboutProject } from "@/app/components/home/idea/AboutProject";
import { CommunityMedia } from "@/app/components/home/media/CommunityMedia";
import { DownloadSection } from "@/app/components/home/modulesection/DownloadSection";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";

export default async function Home() {
    const community = await getCommunityServerData();

    return (
        <>
            <Navbar />
            <main>
                <Hero />
                <CommunityStats
                    playersOnline={community.playersOnline}
                    dedicatedServersCount={community.dedicatedServersCount}
                    battlesToday={null}
                    totalDownloads={null}
                    servers={community.servers}
                    generatedAt={community.generatedAt}
                />
                <CoopFeatures />
                <CommunityMedia />
                <AboutProject />
                <DownloadSection />
            </main>
            <Footer />
        </>
    );
}
