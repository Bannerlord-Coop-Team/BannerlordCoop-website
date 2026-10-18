import { getTranslations } from "@/app/lib/localization/server";
import { Castle, Crown, Gem, Shield, Swords, Users } from "lucide-react";
import { FeatureCard } from "@/app/components/home/features/FeatureCard";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import type { CoopFeature } from "@/app/components/utils/types/feature.types";

// Renders localized CoopFeatures presentation while preserving source values.
export async function CoopFeatures() {
    const { t } = await getTranslations("home");
    const features: CoopFeature[] = [
        {
            id: "shared-campaign",
            eyebrow: t("feature.shared-campaign.eyebrow"),
            title: t("feature.shared-campaign.title"),
            description: t("feature.shared-campaign.description"),
            icon: Crown,
            image: "/images/features/shared.png",
            imageAlt: t("feature.shared-campaign.imageAlt"),
            variant: "hero",
            className:
                "min-h-96 sm:min-h-[30rem] lg:col-span-7 lg:row-span-2 lg:min-h-[34rem]",
        },
        {
            id: "warriors",
            eyebrow: t("feature.warriors.eyebrow"),
            title: t("feature.warriors.title"),
            description: t("feature.warriors.description"),
            icon: Users,
            variant: "text",
            className:
                "lg:col-span-5",
        },
        {
            id: "multiplayer-battles",
            eyebrow: t("feature.multiplayer-battles.eyebrow"),
            title: t("feature.multiplayer-battles.title"),
            description: t("feature.multiplayer-battles.description"),
            icon: Castle,
            image: "/images/features/battles.png",
            imageAlt: t("feature.multiplayer-battles.imageAlt"),
            variant: "image",
            className:
                "min-h-80 lg:col-span-5",
        },
        {
            id: "campaign-management",
            eyebrow: t("feature.campaign-management.eyebrow"),
            title: t("feature.campaign-management.title"),
            description: t("feature.campaign-management.description"),
            icon: Shield,
            variant: "text",
            className:
                "lg:col-span-4",
        },
        {
            id: "persistent-world",
            eyebrow: t("feature.persistent-world.eyebrow"),
            title: t("feature.persistent-world.title"),
            description: t("feature.persistent-world.description"),
            icon: Gem,
            image: "/images/features/persistent.png",
            imageAlt: t("feature.persistent-world.imageAlt"),
            variant: "wide",
            className:
                "min-h-80 lg:col-span-8",
        },
        {
            id: "dedicated-servers",
            eyebrow: t("feature.dedicated-servers.eyebrow"),
            title: t("feature.dedicated-servers.title"),
            description: t("feature.dedicated-servers.description"),
            icon: Swords,
            variant: "wide",
            className:
                "lg:col-span-12",
        },
    ];
    return (
        <section
            id="features"
            className="relative overflow-hidden border-b border-white/10 bg-surface py-16 sm:py-20 lg:py-28 2xl:py-32"
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
                            {t("features.eyebrow")}
                        </p>

                        <h2
                            id="campaign-features-heading"
                            className="mt-4 max-w-4xl font-display text-4xl font-semibold uppercase leading-[0.92] tracking-[-0.03em] text-foreground min-[380px]:text-5xl sm:text-6xl lg:text-7xl 2xl:text-8xl"
                        >
                            {t("features.heading").split("\n").map((line, index, lines) => (
                                <span key={index} className={index === lines.length - 1 ? "block text-gold" : "block"}>{line}</span>
                            ))}
                        </h2>
                    </div>

                    <p className="max-w-xl font-sans text-base leading-7 text-foreground-muted sm:text-lg lg:col-span-4">
                        {t("features.description")}
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