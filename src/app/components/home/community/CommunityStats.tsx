import { Download, Server, Swords, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ActiveGroups } from "@/app/components/home/community/ActiveGroups";
import { StatCard } from "@/app/components/home/community/StatCard";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import type { CoopServer } from "@/app/components/utils/types/server.types";

type CommunityStatsProps = {
    playersOnline: number | null;
    dedicatedServersCount: number | null;
    battlesToday: number | null;
    totalDownloads: number | null;
    servers: CoopServer[];
};

type Stat = {
    label: string;
    description: string;
    value: number | null;
    status: string;
    isLive?: boolean;
    icon: LucideIcon;
};

export function CommunityStats({ playersOnline, dedicatedServersCount, battlesToday, totalDownloads, servers }: CommunityStatsProps) {
    const stats: Stat[] = [
        { label: "Players Online", description: "Across all active servers", value: playersOnline, status: "Pending", icon: Users },
        { label: "Dedicated Servers", description: "Reporting to the network", value: dedicatedServersCount, status: "Pending", icon: Server },
        { label: "Battles Fought", description: "Since 00:00 UTC", value: battlesToday, status: "Pending", icon: Swords },
        { label: "Total Downloads", description: "Across all releases", value: totalDownloads, status: "Pending", icon: Download },
    ];

    return (
        <section className="relative overflow-hidden border-b border-white/10 bg-surface py-20 sm:py-24" aria-labelledby="community-stats-heading">
            <div className="site-container relative">
                <ScrollReveal className="max-w-3xl" amount={0.35}>
                    <p className="font-label text-sm font-semibold uppercase tracking-[0.24em] text-gold">
                        Community Activity
                    </p>
                    <h2 id="community-stats-heading" className="mt-4 font-display text-5xl font-semibold leading-[0.95] tracking-[-0.03em] text-foreground sm:text-6xl">
                        Bannerlord Coop By The Numbers
                    </h2>
                    <p className="mt-5 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                        Current player, server, battle, and download activity from the Bannerlord Coop network.
                    </p>
                </ScrollReveal>

                <div className="mt-12 grid overflow-hidden border border-white/10 bg-surface-raised sm:grid-cols-2 xl:grid-cols-4">
                    {stats.map((stat, index) => (
                        <div key={stat.label} className="border-b border-white/10 sm:border-l sm:nth-last-[-n+2]:border-b-0 xl:border-r xl:border-b-0 xl:even:border-l-0 xl:last:border-r-0">
                            <StatCard {...stat} animationDelay={index * 0.12} />
                        </div>
                    ))}
                </div>
                <ActiveGroups servers={servers} />
            </div>
        </section>
    );
}