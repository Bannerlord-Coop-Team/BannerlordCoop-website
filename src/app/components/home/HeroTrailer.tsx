"use client";

import { useEffect, useRef } from "react";

const TRAILER_URL =
    "https://pub-fb57b9aef9b04b45b38e7f22d548d6a1.r2.dev/trailers/bannerlord-coop-trailer-v4.mp4";
const TRAILER_POSTER_URL =
    "https://pub-fb57b9aef9b04b45b38e7f22d548d6a1.r2.dev/trailers/bannerlord-thumbnail-v2.webp";

export function HeroTrailer() {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = 0.25;
        }
    }, []);

    return (
        <video
            ref={videoRef}
            controls
            playsInline
            preload="none"
            poster={TRAILER_POSTER_URL}
            aria-label="Bannerlord Coop official trailer"
            className="absolute inset-0 size-full object-cover"
        >
            <source src={TRAILER_URL} type="video/mp4" />
            Your browser does not support HTML video. You can{" "}
            <a href={TRAILER_URL}>watch the trailer directly</a>.
        </video>
    );
}
