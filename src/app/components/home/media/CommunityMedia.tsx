import { Clapperboard, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import { VideoCarousel } from "@/app/components/home/media/VideoCarousel";
import type {
    ChannelVideo,
    ContentCreator,
    MediaVideo,
} from "@/app/components/utils/types/media.types";
import { getYouTubeCreators, getYouTubeVideos } from "@/app/lib/youtube";

// Add official YouTube video links here.
const channelVideos: ChannelVideo[] = [
    { href: "https://www.youtube.com/watch?v=Au-oT5KKj0w" },
    { href: "https://www.youtube.com/watch?v=mJ7hZ0-BkZs" },
    { href: "https://www.youtube.com/watch?v=HNiozn0_FZs" },
    { href: "https://www.youtube.com/watch?v=PNBfJXMTHII" },
    { href: "https://www.youtube.com/watch?v=6Y9rNAQN8Jg" },
    { href: "https://www.youtube.com/watch?v=U0F0LIfOBYQ" },
];

const featuredVideos: MediaVideo[] = [
    {
        id: "twitch-2827818732",
        title: "Bannerlord Coop — L'empire contre-attaque!",
        description:
            "Watch CaptainFRACAS play Bannerlord Coop at maximum difficulty, starting at the highlighted moment.",
        thumbnail:
            "https://static-cdn.jtvnw.net/cf_vods/d3stzm2eumvgb4/95c2e4eed29530aa15e1_captainfracas_317326941667_1784898206//thumb/thumb0-640x360.jpg",
        thumbnailAlt: "Bannerlord Coop Twitch VOD by CaptainFRACAS",
        href: "https://www.twitch.tv/videos/2827818732?t=04h20m50s",
        category: "CaptainFRACAS on Twitch",
        duration: "7:06:10",
    },
];

// Add approved content creators here.
const contentCreators: ContentCreator[] = [
    {
        channelId: "UC9sy-WPppdluS2q3crOaFpA",
    },
];

export async function CommunityMedia() {
    const [videos, creators] = await Promise.all([
        getYouTubeVideos(channelVideos.map((video) => video.href)),
        getYouTubeCreators(
            contentCreators.map((creator) => creator.channelId),
        ),
    ]);
    const carouselVideos = [...videos, ...featuredVideos];

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
                        Videos &amp; Community
                    </p>

                    <h2
                        id="community-media-heading"
                        className="mt-4 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-[-0.03em] text-foreground min-[380px]:text-5xl sm:text-6xl lg:text-7xl 2xl:text-8xl"
                    >
                        Bannerlord Coop
                        <span className="block text-gold">In Action</span>
                    </h2>

                    <p className="mt-6 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                        Watch gameplay, development updates, and guides from the
                        Bannerlord Coop team and community creators.
                    </p>
                </ScrollReveal>

                {carouselVideos.length > 0 && (
                    <div className="mt-10 sm:mt-12 lg:mt-14">
                        <div className="flex items-end justify-between gap-6 border-b border-white/10 pb-5">
                            <div>
                                <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                                    Featured Videos
                                </p>
                                <h3 className="mt-2 font-display text-3xl font-semibold uppercase text-foreground sm:text-4xl">
                                    Latest Videos
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
                                Community
                            </p>
                            <h3 className="mt-2 font-display text-3xl font-semibold uppercase text-foreground sm:text-4xl">
                                Featured Content Creators
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
                                                alt={`${creator.name} YouTube channel avatar`}
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