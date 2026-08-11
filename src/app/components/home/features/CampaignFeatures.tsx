import { Castle, Crown, Gem, Shield, Swords, Users } from "lucide-react";
import { FeatureCard } from "@/app/components/home/features/FeatureCard";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import type { CoopFeature } from "@/app/components/utils/types/feature.types";

const features: CoopFeature[] = [
    {
        id: "shared-campaign",
        eyebrow: "Persistent Campaign",
        title: "A Shared Campaign",
        description:
            "Travel across the same persistent campaign map while controlling your own character, party, clan, troops, and resources.",
        icon: Crown,
        image: "/images/features/coop.jpg",
        imageAlt:
            "Warriors overlooking the landscape of Calradia",
        variant: "hero",
        className:
            "min-h-96 sm:min-h-[30rem] lg:col-span-7 lg:row-span-2 lg:min-h-[34rem]",
    },
    {
        id: "warriors",
        eyebrow: "Player Count",
        title: "Up To 8 Players",
        description:
            "Ride with up to seven companions in campaigns optimized for eight players, each commanding their own character and forces.",
        icon: Users,
        variant: "text",
        className:
            "lg:col-span-5",
    },
    {
        id: "multiplayer-battles",
        eyebrow: "PvE And PvP",
        title: "Multiplayer Battles",
        description:
            "Enter field battles as allies or opponents, with AI parties able to join under supported campaign conditions.",
        icon: Castle,
        image: "/images/features/siege.webp",
        imageAlt:
            "A medieval siege against a fortified settlement",
        variant: "image",
        className:
            "min-h-80 lg:col-span-5",
    },
    {
        id: "campaign-management",
        eyebrow: "Campaign Systems",
        title: "Manage Your Domain",
        description:
            "Manage parties, troops, clans, kingdoms, and settlements while recruiting, trading, and building your strength.",
        icon: Shield,
        variant: "text",
        className:
            "lg:col-span-4",
    },
    {
        id: "persistent-world",
        eyebrow: "Synchronized Progress",
        title: "Persistent World",
        description:
            "Movement, encounters, battles, and campaign progress stay synchronized as every player shapes the same world.",
        icon: Gem,
        image: "/images/features/castle.jpg",
        imageAlt:
            "A castle overlooking the persistent world of Calradia",
        variant: "wide",
        className:
            "min-h-80 lg:col-span-8",
    },
    {
        id: "dedicated-servers",
        eyebrow: "Hosting",
        title: "Dedicated Server Support",
        description:
            "Host shared campaigns with dedicated server support and Steam integration for greater performance and stability.",
        icon: Swords,
        variant: "wide",
        className:
            "lg:col-span-12",
    },
];

export function CoopFeatures() {
    return (
        <section
            id="features"
            className="relative overflow-hidden border-b border-white/10 bg-background py-16 sm:py-20 lg:py-28 2xl:py-32"
            aria-labelledby="campaign-features-heading"
        >
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(circle_at_8%_15%,rgba(143,29,35,0.08),transparent_30%)]"
            />

            <div className="site-container relative">
                <ScrollReveal
                    className="grid gap-8 lg:grid-cols-12 lg:items-end"
                    amount={0.3}
                >
                    <div className="lg:col-span-8">
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold sm:text-sm sm:tracking-[0.24em]">
                            Campaign Features
                        </p>

                        <h2
                            id="campaign-features-heading"
                            className="mt-4 max-w-4xl font-display text-4xl font-semibold uppercase leading-[0.92] tracking-[-0.03em] text-foreground min-[380px]:text-5xl sm:text-6xl lg:text-7xl 2xl:text-8xl"
                        >
                            Play Bannerlord.
                            <br />
                            <span className="text-gold">
                                With Your Friends.
                            </span>
                        </h2>
                    </div>

                    <p className="max-w-xl font-sans text-base leading-7 text-foreground-muted sm:text-lg lg:col-span-4">
                        Share a persistent campaign world while commanding your
                        own character, party, clan, troops, and resources
                        alongside your fellow players.
                    </p>
                </ScrollReveal>

                <div className="mt-10 grid auto-rows-fr gap-4 sm:mt-12 lg:mt-14 lg:grid-cols-12">
                    {features.map((feature, index) => (
                        <FeatureCard
                            key={feature.id}
                            feature={feature}
                            animationDelay={index * 0.08}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}