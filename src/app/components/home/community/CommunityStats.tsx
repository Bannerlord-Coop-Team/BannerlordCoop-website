import { getTranslations } from "@/app/lib/localization/server";
import { Download, Server, Swords, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StatCard } from "@/app/components/home/community/StatCard";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";

type CommunityStatsProps = {
    playersOnline: number | null;
    dedicatedServersCount: number | null;
    battlesFoughtTotal: number | null;
    totalDownloads: number | null;
};

type Stat = {
    label: string;
    description: string;
    value: number | null;
    status: string;
    isLive?: boolean;
    icon: LucideIcon;
};

// Renders localized CommunityStats presentation while preserving source values.
export async function CommunityStats({
    playersOnline,
    dedicatedServersCount,
    battlesFoughtTotal,
    totalDownloads,
}: CommunityStatsProps) {
    const { t } = await getTranslations("home");
    const stats: Stat[] = [
        {
            label: t("stats.players"),
            description: t("stats.playersDescription"),
            value: playersOnline,
            status: playersOnline === null ? t("stats.unavailable") : t("stats.live"),
            isLive: playersOnline !== null,
            icon: Users,
        },
        {
            label: t("stats.servers"),
            description: t("stats.serversDescription"),
            value: dedicatedServersCount,
            status: dedicatedServersCount === null ? t("stats.unavailable") : t("stats.live"),
            isLive: dedicatedServersCount !== null,
            icon: Server,
        },
        {
            label: t("stats.battles"),
            description: t("stats.battlesDescription"),
            value: battlesFoughtTotal,
            status: battlesFoughtTotal === null ? t("stats.unavailable") : t("stats.live"),
            isLive: battlesFoughtTotal !== null,
            icon: Swords,
        },
        {
            label: t("stats.downloads"),
            description: t("stats.downloadsDescription"),
            value: totalDownloads,
            status: totalDownloads === null ? t("stats.unavailable") : t("stats.live"),
            isLive: totalDownloads !== null,
            icon: Download,
        },
    ];

    return (
        <section className="relative overflow-hidden border-b border-white/10 bg-surface py-16 sm:py-20 lg:py-24 2xl:py-28" aria-labelledby="community-stats-heading">
            <div className="site-container relative">
                <ScrollReveal className="max-w-3xl" amount={0.35}>
                    <p className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold sm:text-sm sm:tracking-[0.24em]">
                        {t("stats.eyebrow")}
                    </p>
                    <h2 id="community-stats-heading" className="mt-4 font-display text-4xl font-semibold leading-[0.95] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl 2xl:text-7xl">
                        {t("stats.heading")}
                    </h2>
                    <p className="mt-5 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                        {t("stats.description")}
                    </p>
                </ScrollReveal>

                <div className="mt-10 grid overflow-hidden border border-white/10 bg-surface-raised sm:mt-12 sm:grid-cols-2 xl:grid-cols-4">
                    {stats.map((stat, index) => (
                        <div key={stat.label} className="border-b border-white/10 sm:odd:border-r sm:nth-3:border-b-0 xl:border-r xl:border-b-0 xl:last:border-r-0">
                            <StatCard {...stat} animationDelay={index * 0.12} />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}