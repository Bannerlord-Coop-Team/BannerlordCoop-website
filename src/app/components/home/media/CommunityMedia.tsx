import { getTranslations } from "@/app/lib/localization/server";
import { Clapperboard, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import { VideoCarousel } from "@/app/components/home/media/VideoCarousel";
import type { ContentCreator } from "@/app/components/utils/types/media.types";
import { getYouTubeCreators } from "@/app/lib/youtube";
import { getHomepageVideos } from "@/app/lib/homepage-videos";

// Add approved content creators here.
const contentCreators: ContentCreator[] = [
    {
        channelId: "UC9sy-WPppdluS2q3crOaFpA",
    },
];

// Localizes media labels and explicitly keyed editorial fields, preserving external content.
export async function CommunityMedia() {
    const { t } = await getTranslations("home");
    const [videos, creators] = await Promise.all([
        getHomepageVideos({
            fallbackTitle: t("media.fallbackTitle"),
            // Labels generated thumbnails without translating external video titles.
            videoThumbnail: (title) => t("media.videoThumbnail", { title }),
            // Labels fallback thumbnails when remote metadata cannot be retrieved.
            fallbackThumbnail: (title) => t("media.fallbackThumbnail", { title }),
        }),
        getYouTubeCreators(
            contentCreators.map((creator) => creator.channelId),
        ),
    ]);
    // Resolve only assigned editorial keys; new and unmapped rows retain their source prose.
    const carouselVideos = videos.map((video) => ({
        ...video,
        description: video.description_translation_key ? t(video.description_translation_key) : video.description,
        thumbnailAlt: video.thumbnail_alt_translation_key ? t(video.thumbnail_alt_translation_key) : video.thumbnailAlt,
        category: video.category_translation_key ? t(video.category_translation_key) : video.category,
    }));

    return (
        <section
            id="media"
            className="relative overflow-hidden border-b border-white/10 bg-background py-16 sm:py-20 lg:py-28 2xl:py-32"
            aria-labelledby="community-media-heading"
        >
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(170,151,96,0.07),transparent_38%)]"
            />

            <div className="site-container relative">
                <ScrollReveal className="max-w-4xl" amount={0.3}>
                    <p className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold sm:text-sm sm:tracking-[0.24em]">
                        {t("media.eyebrow")}
                    </p>

                    <h2
                        id="community-media-heading"
                        className="mt-4 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-[-0.03em] text-foreground min-[380px]:text-5xl sm:text-6xl lg:text-7xl 2xl:text-8xl"
                    >
                        {t("media.heading").split("\n").map((line, index, lines) => (
                                <span key={index} className={index === lines.length - 1 ? "block text-gold" : "block"}>{line}</span>
                            ))}
                    </h2>

                    <p className="mt-6 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                        {t("media.description")}
                    </p>
                </ScrollReveal>

                {carouselVideos.length > 0 && (
                    <div className="mt-10 sm:mt-12 lg:mt-14">
                        <div className="flex items-end justify-between gap-6 border-b border-white/10 pb-5">
                            <div>
                                <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                                    {t("media.featured")}
                                </p>
                                <h3 className="mt-2 font-display text-3xl font-semibold uppercase text-foreground sm:text-4xl">
                                    {t("media.latest")}
                                </h3>
                            </div>

                            <Clapperboard
                                aria-hidden="true"
                                strokeWidth={1.25}
                                className="hidden size-8 text-foreground-dim sm:block"
                            />
                        </div>

                        <VideoCarousel videos={carouselVideos} />
                    </div>
                )}

                {creators.length > 0 && (
                    <div className="mt-14 sm:mt-16 lg:mt-20">
                        <div className="border-b border-white/10 pb-5">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                                {t("media.community")}
                            </p>
                            <h3 className="mt-2 font-display text-3xl font-semibold uppercase text-foreground sm:text-4xl">
                                {t("media.creators")}
                            </h3>
                        </div>

                        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {creators.map((creator, index) => (
                                <ScrollReveal
                                    key={creator.id}
                                    delay={index * 0.08}
                                    distance={20}
                                    amount={0.2}
                                    className="h-full"
                                >
                                    <Link
                                        href={creator.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group flex h-full flex-col items-start gap-4 rounded-sm border border-white/10 bg-surface-raised p-5 transition-colors duration-300 hover:border-gold/40 hover:bg-white/2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-surface min-[420px]:flex-row min-[420px]:items-center sm:p-6"
                                    >
                                        {creator.avatar ? (
                                            <Image
                                                src={creator.avatar}
                                                alt={t("media.avatar", { name: creator.name })}
                                                width={72}
                                                height={72}
                                                className="size-16 shrink-0 rounded-full border border-white/10 object-cover grayscale transition-[filter,border-color] duration-300 group-hover:border-gold/40 group-hover:grayscale-0 sm:size-18"
                                            />
                                        ) : (
                                            <span
                                                aria-hidden="true"
                                                className="flex size-16 shrink-0 items-center justify-center rounded-full border border-white/10 bg-background font-display text-2xl font-semibold uppercase text-gold sm:size-18 sm:text-3xl"
                                            >
                                                {creator.name.charAt(0)}
                                            </span>
                                        )}

                                        <article className="min-w-0 flex-1">
                                            <div className="flex items-start justify-between gap-3">
                                                <h4 className="wrap-break-word font-display text-xl font-semibold text-foreground sm:text-2xl">
                                                    {creator.name}
                                                </h4>
                                                <ExternalLink
                                                    aria-hidden="true"
                                                    className="mt-1 size-4 shrink-0 text-foreground-dim transition-colors group-hover:text-gold"
                                                />
                                            </div>
                                            {creator.description && (
                                                <p className="mt-2 line-clamp-3 wrap-break-word font-sans text-sm leading-6 text-foreground-muted">
                                                    {creator.description}
                                                </p>
                                            )}
                                        </article>
                                    </Link>
                                </ScrollReveal>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}