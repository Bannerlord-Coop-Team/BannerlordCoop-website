import "server-only";
import type {YouTubeCreator, YouTubeVideo} from "@/app/components/utils/types/media.types";

type YouTubeThumbnail = {
    url: string;
};

type YouTubeChannelResponse = {
    items?: Array<{
        id: string;
        snippet?: {
            title?: string;
            description?: string;
            customUrl?: string;
            thumbnails?: {
                high?: YouTubeThumbnail;
                medium?: YouTubeThumbnail;
                default?: YouTubeThumbnail;
            };
        };
    }>;
};

type YouTubeVideoResponse = {
    items?: Array<{
        id: string;
        snippet?: {
            title?: string;
            description?: string;
            channelTitle?: string;
            thumbnails?: {
                maxres?: YouTubeThumbnail;
                standard?: YouTubeThumbnail;
                high?: YouTubeThumbnail;
                medium?: YouTubeThumbnail;
                default?: YouTubeThumbnail;
            };
        };
        contentDetails?: {
            duration?: string;
        };
    }>;
};

export async function getYouTubeCreators(
    channelIds: string[],
): Promise<YouTubeCreator[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const uniqueChannelIds = [...new Set(channelIds.filter(Boolean))];

    if (!apiKey || uniqueChannelIds.length === 0) {
        return [];
    }

    const parameters = new URLSearchParams({
        part: "snippet",
        id: uniqueChannelIds.join(","),
        key: apiKey,
    });

    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?${parameters}`,
            {
                next: {
                    revalidate: 86400,
                },
            },
        );

        if (!response.ok) {
            console.error(
                `YouTube channel request failed with status ${response.status}.`,
            );
            return [];
        }

        const data = (await response.json()) as YouTubeChannelResponse;

        return (
            (data.items ?? []).flatMap((channel) => {
                const name = channel.snippet?.title;

                if (!name) {
                    return [];
                }

                const thumbnails = channel.snippet?.thumbnails;
                const avatar =
                    thumbnails?.high?.url ??
                    thumbnails?.medium?.url ??
                    thumbnails?.default?.url ??
                    null;
                const customUrl = channel.snippet?.customUrl;

                return [{
                    id: channel.id,
                    name,
                    description: createDescriptionExcerpt(
                        channel.snippet?.description,
                    ),
                    avatar,
                    href: customUrl
                        ? `https://www.youtube.com/${customUrl}`
                        : `https://www.youtube.com/channel/${channel.id}`,
                }];
            })
        );
    } catch (error) {
        console.error("Unable to retrieve YouTube creator details.", error);
        return [];
    }
}

export async function getYouTubeVideos(
    videoUrls: string[],
): Promise<YouTubeVideo[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const videoIds = [
        ...new Set(videoUrls.map(getYouTubeVideoId).filter(isString)),
    ];

    if (!apiKey || videoIds.length === 0) {
        return [];
    }

    const parameters = new URLSearchParams({
        part: "snippet,contentDetails",
        id: videoIds.join(","),
        key: apiKey,
    });

    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?${parameters}`,
            {
                next: {
                    revalidate: 86400,
                },
            },
        );

        if (!response.ok) {
            console.error(
                `YouTube video request failed with status ${response.status}.`,
            );
            return [];
        }

        const data = (await response.json()) as YouTubeVideoResponse;

        return (data.items ?? []).flatMap((video) => {
            const title = video.snippet?.title;
            const thumbnails = video.snippet?.thumbnails;
            const thumbnail =
                thumbnails?.maxres?.url ??
                thumbnails?.standard?.url ??
                thumbnails?.high?.url ??
                thumbnails?.medium?.url ??
                thumbnails?.default?.url;

            if (!title || !thumbnail) {
                return [];
            }

            return [{
                id: video.id,
                title,
                description: createDescriptionExcerpt(
                    video.snippet?.description,
                ),
                thumbnail,
                thumbnailAlt: `${title} video thumbnail`,
                href: `https://www.youtube.com/watch?v=${video.id}`,
                category: video.snippet?.channelTitle ?? "YouTube",
                duration: formatYouTubeDuration(
                    video.contentDetails?.duration,
                ),
            }];
        });
    } catch (error) {
        console.error("Unable to retrieve YouTube video details.", error);
        return [];
    }
}

function getYouTubeVideoId(videoUrl: string): string | null {
    try {
        const url = new URL(videoUrl);
        const hostname = url.hostname.replace(/^www\./, "");

        if (hostname === "youtu.be") {
            return normalizeVideoId(url.pathname.split("/")[1]);
        }

        if (hostname !== "youtube.com" && hostname !== "m.youtube.com") {
            return null;
        }

        if (url.pathname === "/watch") {
            return normalizeVideoId(url.searchParams.get("v"));
        }

        const [resource, id] = url.pathname.split("/").filter(Boolean);

        if (["shorts", "embed", "live"].includes(resource)) {
            return normalizeVideoId(id);
        }

        return null;
    } catch {
        return null;
    }
}

function normalizeVideoId(value?: string | null): string | null {
    return value && /^[a-zA-Z0-9_-]{11}$/.test(value) ? value : null;
}

function formatYouTubeDuration(duration?: string): string | null {
    if (!duration) {
        return null;
    }

    const match = duration.match(
        /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/,
    );

    if (!match) {
        return null;
    }

    const days = Number(match[1] ?? 0);
    const hours = Number(match[2] ?? 0) + days * 24;
    const minutes = Number(match[3] ?? 0);
    const seconds = Number(match[4] ?? 0);

    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isString(value: string | null): value is string {
    return value !== null;
}

function createDescriptionExcerpt(description?: string): string {
    if (!description) {
        return "";
    }

    const normalizedDescription = description
        .replace(/https?:\/\/\S+|www\.\S+/gi, "")
        .replace(/\s+/g, " ")
        .trim();

    if (normalizedDescription.length <= 180) {
        return normalizedDescription;
    }

    const excerpt = normalizedDescription.slice(0, 181);
    const lastWordBoundary = excerpt.lastIndexOf(" ");

    return `${excerpt.slice(0, lastWordBoundary > 0 ? lastWordBoundary : 180).trimEnd()}…`;
}