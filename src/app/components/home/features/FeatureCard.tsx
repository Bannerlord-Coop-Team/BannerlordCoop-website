import Image from "next/image";
import type { CoopFeature } from "@/app/components/utils/types/feature.types";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";

type FeatureCardProps = {
    feature: CoopFeature;
    animationDelay?: number;
};

export function FeatureCard({ feature, animationDelay = 0 }: FeatureCardProps) {
    const Icon = feature.icon;
    const hasImage = Boolean(feature.image);
    return (
        <ScrollReveal
            className={feature.className}
            delay={animationDelay}
            distance={28}
            amount={0.15}
        >
            <article className="group relative isolate h-full min-h-72 overflow-hidden border border-white/10 bg-surface-raised">
                {hasImage && (
                    <>
                        <Image
                            src={feature.image!}
                            alt={feature.imageAlt ?? ""}
                            fill
                            sizes={
                                feature.variant === "hero"
                                    ? "(min-width: 1280px) 55vw, 100vw"
                                    : "(min-width: 1280px) 35vw, 100vw"
                            }
                            className="absolute -z-30 object-cover grayscale transition-transform duration-700 ease-out group-hover:scale-[1.025] group-hover:grayscale-0"
                        />

                        <div
                            aria-hidden="true"
                            className="absolute inset-0 -z-20 bg-black/25"
                        />

                        <div
                            aria-hidden="true"
                            className="absolute inset-0 -z-20 bg-linear-to-t from-background via-background/55 to-transparent"
                        />
                    </>
                )}

                {!hasImage && (
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_100%_0%,rgba(170,151,96,0.09),transparent_42%)]"
                    />
                )}

                <div className="flex h-full flex-col justify-between p-7 sm:p-9">
                    <div className="flex items-start justify-between gap-6">
                        {Icon ? (
                            <span className="flex size-11 items-center justify-center border-2 border-gold bg-gold/5 text-gold">
                                <Icon
                                    aria-hidden="true"
                                    className="size-5"
                                    strokeWidth={2}
                                />
                            </span>
                        ) : (
                            <span className="h-px w-10 bg-gold-muted" />
                        )}
                    </div>

                    <div className="mt-16">
                        {feature.eyebrow && (
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                                {feature.eyebrow}
                            </p>
                        )}

                        <h3
                            className={
                                feature.variant === "hero"
                                    ? "mt-3 font-display text-4xl font-semibold uppercase leading-[0.95] tracking-[-0.02em] text-foreground sm:text-5xl"
                                    : "mt-3 font-display text-3xl font-semibold uppercase leading-none tracking-[-0.02em] text-foreground"
                            }
                        >
                            {feature.title}
                        </h3>

                        <p className="mt-4 max-w-md font-sans text-sm leading-6 text-foreground-muted">
                            {feature.description}
                        </p>
                    </div>
                </div>

                <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-crimson-hover transition-transform duration-500 group-hover:scale-x-100"
                />
            </article>
        </ScrollReveal>
    );
}