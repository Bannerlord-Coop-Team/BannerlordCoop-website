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
    platformReach: number | null;
    servers: CoopServer[];
    generatedAt: string | null;
};

type Stat = {
    label: string;
    description: string;
    value: number | null;
    status: string;
    isLive?: boolean;
    icon: LucideIcon;
};

export function CommunityStats({ playersOnline, dedicatedServersCount, battlesToday, platformReach, servers, generatedAt }: CommunityStatsProps) {
    const registryAvailable = generatedAt !== null;
    const stats: Stat[] = [
        { label: "Players Online", description: "Across all active servers", value: playersOnline, status: registryAvailable ? "Live" : "Unavailable", isLive: registryAvailable, icon: Users },
        { label: "Dedicated Servers", description: "Reporting to the network", value: dedicatedServersCount, status: registryAvailable ? "Live" : "Unavailable", isLive: registryAvailable, icon: Server },
        { label: "Battles Fought", description: "Since 00:00 UTC", value: battlesToday, status: "Pending", icon: Swords },
        { label: "Platform Reach", description: "Total Community Outreach", value: platformReach, status: platformReach === null ? "Unavailable" : "Live", isLive: platformReach !== null, icon: Download },
    ];

    return (
        <section className="relative overflow-hidden border-b border-white/10 bg-surface py-16 sm:py-20 lg:py-24 2xl:py-28" aria-labelledby="community-stats-heading">
            <div className="site-container relative">
                <ScrollReveal className="max-w-3xl" amount={0.35}>
                    <p className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold sm:text-sm sm:tracking-[0.24em]">
                        Community Activity
                    </p>
                    <h2 id="community-stats-heading" className="mt-4 font-display text-4xl font-semibold leading-[0.95] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl 2xl:text-7xl">
                        Bannerlord Coop By The Numbers
                    </h2>
                    <p className="mt-5 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                        Current player, server, battle, and download activity from the Bannerlord Coop network.
                    </p>
                </ScrollReveal>

                <div className="mt-10 grid overflow-hidden border border-white/10 bg-surface-raised sm:mt-12 sm:grid-cols-2 xl:grid-cols-4">
                    {stats.map((stat, index) => (
                        <div key={stat.label} className="border-b border-white/10 sm:odd:border-r sm:nth-3:border-b-0 xl:border-r xl:border-b-0 xl:last:border-r-0">
                            <StatCard {...stat} animationDelay={index * 0.12} />
                        </div>
                    ))}
                </div>
                <ActiveGroups
                    servers={servers}
                    dataAvailable={registryAvailable}
                    lastUpdated={formatLastUpdated(generatedAt)}
                />
            </div>
        </section>
    );
}

function formatLastUpdated(value: string | null): string | undefined {
    if (value === null) return undefined;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;

    return new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
    }).format(date);
}