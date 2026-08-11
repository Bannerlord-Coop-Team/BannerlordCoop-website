import { ServerCog, Shield, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";

type ProjectPrinciple = {
    title: string;
    description: string;
    icon: LucideIcon;
};

const principles: ProjectPrinciple[] = [
    {
        title: "The Goal",
        description:
            "Transform Bannerlord’s campaign into a shared experience without losing what makes it distinct. Each player keeps command of their own character, party, clan, troops, and resources.",
        icon: Shield,
    },
    {
        title: "The Work",
        description:
            "Synchronizing a persistent campaign takes careful engineering and constant refinement. Dedicated servers, Steam integration, testing, and stability improvements keep the shared realm moving.",
        icon: ServerCog,
    },
    {
        title: "The Community",
        description:
            "A volunteer team builds the mod with help from its community. Playing, reporting reproducible bugs, creating content, sharing the project, and contributing code all move it forward.",
        icon: Users,
    },
];

export function AboutProject() {
    return (
        <section
            id="about"
            className="relative overflow-hidden border-b border-white/10 bg-surface py-24 sm:py-32"
            aria-labelledby="about-project-heading"
        >
            <div className="site-container relative">
                <ScrollReveal
                    className="max-w-4xl"
                    amount={0.3}
                >
                    <p className="font-label text-sm font-semibold uppercase tracking-[0.24em] text-gold">
                        About The Project
                    </p>

                    <h2
                        id="about-project-heading"
                        className="mt-4 font-display text-5xl font-semibold uppercase leading-[0.9] tracking-[-0.035em] text-foreground sm:text-6xl lg:text-7xl"
                    >
                        Built For Shared Campaigns
                    </h2>

                    <p className="mt-6 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                        Bannerlord Coop turns the single-player campaign into a
                        persistent multiplayer world where friends can travel,
                        rule, trade, and fight across Calradia together.
                    </p>
                </ScrollReveal>

                <div className="mt-14 grid lg:grid-cols-3">
                    {principles.map((item, index) => {
                        const Icon = item.icon;

                        return (
                            <ScrollReveal
                                key={item.title}
                                delay={index * 0.1}
                                distance={20}
                                amount={0.35}
                                className="border-b border-white/10 py-10 first:pt-0 last:pb-0 lg:border-r lg:border-b-0 lg:px-12 lg:py-2 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0"
                            >
                                <Icon
                                    aria-hidden="true"
                                    strokeWidth={1.25}
                                    className="size-9 text-gold"
                                />

                                <div
                                    aria-hidden="true"
                                    className="mt-6 flex items-center gap-2"
                                >
                                    <span className="h-px w-10 bg-gold" />
                                    <span className="size-1 rotate-45 border border-gold-muted" />
                                </div>

                                <h3 className="mt-5 font-display text-3xl font-semibold uppercase tracking-[0.04em] text-foreground sm:text-4xl">
                                    {item.title}
                                </h3>

                                <p className="mt-4 max-w-sm font-sans text-sm leading-7 text-foreground-muted sm:text-base">
                                    {item.description}
                                </p>
                            </ScrollReveal>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}