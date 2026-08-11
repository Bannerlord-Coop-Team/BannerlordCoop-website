import { Hero } from "@/app/components/home/Hero";
import { CommunityStats } from "@/app/components/home/community/CommunityStats";
import { CoopFeatures } from "@/app/components/home/features/CampaignFeatures";
import { AboutProject } from "@/app/components/home/idea/AboutProject";
import { CommunityMedia } from "@/app/components/home/media/CommunityMedia";
import { DownloadSection } from "@/app/components/home/modulesection/DownloadSection";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";

export default function Home() {
    return (
        <>
            <Navbar />
            <main>
                <Hero />
                <CommunityStats
                    playersOnline={null}
                    dedicatedServersCount={null}
                    battlesToday={null}
                    totalDownloads={null}
                    servers={[]}
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
