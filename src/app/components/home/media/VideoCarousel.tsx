"use client";

import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { YouTubeVideo } from "@/app/components/utils/types/media.types";

type VideoCarouselProps = {
    videos: YouTubeVideo[];
};

export function VideoCarousel({ videos }: VideoCarouselProps) {
    const carouselRef = useRef<HTMLDivElement>(null);
    const [activePage, setActivePage] = useState(0);
    const [pageCount, setPageCount] = useState(1);
    const isCarousel = videos.length > 2;

    const updateCarouselState = useCallback(() => {
        const carousel = carouselRef.current;

        if (!carousel) {
            return;
        }

        const maxScrollLeft = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
        const nextPageCount = Math.max(1, Math.ceil(maxScrollLeft / carousel.clientWidth) + 1);
        const nextActivePage = Math.min(
            nextPageCount - 1,
            maxScrollLeft === 0
                ? 0
                : Math.round((carousel.scrollLeft / maxScrollLeft) * (nextPageCount - 1)),
        );

        setPageCount(nextPageCount);
        setActivePage(nextActivePage);
    }, []);

    useEffect(() => {
        const carousel = carouselRef.current;

        if (!carousel || !isCarousel) {
            return;
        }

        updateCarouselState();
        const resizeObserver = new ResizeObserver(updateCarouselState);
        resizeObserver.observe(carousel);

        return () => resizeObserver.disconnect();
    }, [isCarousel, updateCarouselState]);

    function goToPage(page: number) {
        const carousel = carouselRef.current;

        if (!carousel) {
            return;
        }

        const targetPage = Math.max(0, Math.min(page, pageCount - 1));
        const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        ).matches;

        const maxScrollLeft = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
        carousel.scrollTo({
            left: pageCount === 1
                ? 0
                : (targetPage / (pageCount - 1)) * maxScrollLeft,
            behavior: reduceMotion ? "auto" : "smooth",
        });
        setActivePage(targetPage);
    }

    return (
        <div className="mt-6">
            <div
                ref={carouselRef}
                onScroll={updateCarouselState}
                className={
                    isCarousel
                        ? "grid snap-x snap-mandatory auto-cols-[100%] grid-flow-col gap-4 overflow-x-auto overscroll-x-contain scrollbar-none lg:auto-cols-[calc((100%-1rem)/2)]"
                        : "grid gap-4 lg:grid-cols-2"
                }
                aria-label={isCarousel ? "Official video carousel" : undefined}
            >
                {videos.map((video) => (
                    <VideoCard
                        key={video.id}
                        video={video}
                        isCarousel={isCarousel}
                    />
                ))}
            </div>

            {isCarousel && pageCount > 1 && (
                <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-5 sm:mt-6 sm:gap-6">
                    <p
                        className="font-label text-xs uppercase tracking-[0.16em] text-foreground-dim"
                        aria-live="polite"
                    >
                        {activePage + 1} of {pageCount}
                    </p>

                    <div className="flex items-center gap-3 sm:gap-5">
                        <div className="hidden items-center gap-2 md:flex">
                            {Array.from({ length: pageCount }, (_, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    onClick={() => goToPage(index)}
                                    className={`h-1 transition-[width,background-color] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-surface ${
                                        activePage === index
                                            ? "w-8 bg-gold"
                                            : "w-4 bg-white/20 hover:bg-white/40"
                                    }`}
                                    aria-label={`Go to video page ${index + 1}`}
                                    aria-current={activePage === index ? "true" : undefined}
                                />
                            ))}
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => goToPage(activePage - 1)}
                                disabled={activePage === 0}
                                className="flex size-10 items-center justify-center border border-white/15 text-foreground transition-colors duration-300 hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/15 disabled:hover:text-foreground sm:size-11"
                                aria-label="Previous video page"
                            >
                                <ChevronLeft aria-hidden="true" className="size-5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => goToPage(activePage + 1)}
                                disabled={activePage === pageCount - 1}
                                className="flex size-10 items-center justify-center border border-white/15 text-foreground transition-colors duration-300 hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/15 disabled:hover:text-foreground sm:size-11"
                                aria-label="Next video page"
                            >
                                <ChevronRight aria-hidden="true" className="size-5" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

type VideoCardProps = {
    video: YouTubeVideo;
    isCarousel: boolean;
};

function VideoCard({ video, isCarousel }: VideoCardProps) {
    return (
        <Link
            href={video.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`group block h-full overflow-hidden rounded-xl border border-white/10 bg-surface-raised transition-colors duration-300 hover:border-gold/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-surface ${isCarousel ? "snap-start" : ""}`}
        >
            <article>
                <div className="relative aspect-video overflow-hidden bg-background">
                    <Image
                        src={video.thumbnail}
                        alt={video.thumbnailAlt}
                        fill
                        sizes="(min-width: 1024px) 50vw, 100vw"
                        className="object-cover opacity-80 transition-[opacity,transform] duration-500 group-hover:scale-[1.03] group-hover:opacity-100"
                    />
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-linear-to-t from-background/75 via-transparent to-transparent"
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex size-12 items-center justify-center rounded-sm border border-white/25 bg-background/80 text-foreground transition-colors duration-300 group-hover:border-crimson group-hover:bg-crimson-hover sm:size-14">
                            <Play aria-hidden="true" className="size-5 fill-current" />
                        </span>
                    </span>
                    {video.duration && (
                        <span className="absolute right-3 bottom-3 bg-background/90 px-2 py-1 font-label text-xs text-foreground">
                            {video.duration}
                        </span>
                    )}
                </div>

                <div className="p-5 sm:p-7">
                    <p className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                        {video.category}
                    </p>
                    <h4 className="mt-3 font-display text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
                        {video.title}
                    </h4>
                    {video.description && (
                        <p className="mt-4 max-w-xl line-clamp-3 wrap-break-word font-sans text-sm leading-6 text-foreground-muted">
                            {video.description}
                        </p>
                    )}
                </div>
            </article>
        </Link>
    );
}