import "server-only";
import type { MediaVideo, YouTubeVideo } from "@/app/components/utils/types/media.types";
import { fetchPublicRows, type PublicRowsReader } from "./supabase/public-rows";
import { getYouTubeVideoId, getYouTubeVideos, type YouTubeLabels } from "./youtube";

export type HomepageVideo = MediaVideo & {
    description_translation_key?: string | null;
    thumbnail_alt_translation_key?: string | null;
    category_translation_key?: string | null;
};

export type HomepageVideoRow = {
    id: string;
    source: "youtube" | "custom";
    href: string;
    title: string | null;
    description: string;
    thumbnail: string | null;
    thumbnail_alt: string | null;
    category: string;
    duration: string | null;
    description_translation_key?: string | null;
    thumbnail_alt_translation_key?: string | null;
    category_translation_key?: string | null;
};

const homepageVideoQuery = {
    select: "id,source,href,title,description,thumbnail,thumbnail_alt,category,duration,description_translation_key,thumbnail_alt_translation_key,category_translation_key",
    published: "eq.true",
    order: "published_at.desc.nullslast,sort_order.asc,id.asc",
};

// Optional overrides for the row reader and the YouTube resolver; omitted ones default to the live Supabase and YouTube calls.
// A resolver must return each video with `id` set to its YouTube video ID, which is how rows are matched to results.
export type HomepageVideoDependencies = {
    readRows?: PublicRowsReader<HomepageVideoRow>;
    resolveYouTubeVideos?: typeof getYouTubeVideos;
};

// Loads ordered homepage media with explicit editorial keys and generated YouTube labels.
export async function getHomepageVideos(labels?: YouTubeLabels, {
    readRows = fetchPublicRows,
    resolveYouTubeVideos = getYouTubeVideos,
}: HomepageVideoDependencies = {}): Promise<HomepageVideo[]> {
    const rows = await readRows("homepage_videos", homepageVideoQuery);
    const youtubeVideos = await resolveYouTubeVideos(
        rows.filter((row) => row.source === "youtube").map((row) => row.href),
        labels,
    );
    const byVideoId = new Map(youtubeVideos.map((video) => [video.id, video]));
    // Keep table order, dropping rows toHomepageVideo cannot display.
    return rows.map((row) => toHomepageVideo(row, byVideoId)).filter((video) => video !== null);
}

// Maps one row to a carousel video, or null when the row cannot be displayed.
export function toHomepageVideo(row: HomepageVideoRow, youtubeVideosById: Map<string, YouTubeVideo>): HomepageVideo | null {
    if (row.source === "youtube") return toYouTubeHomepageVideo(row, youtubeVideosById);
    return toCustomHomepageVideo(row);
}

// Attaches a YouTube row's resolved details, keeping the row's id and href; null when its details did not resolve.
function toYouTubeHomepageVideo(row: HomepageVideoRow, youtubeVideosById: Map<string, YouTubeVideo>): HomepageVideo | null {
    const videoId = getYouTubeVideoId(row.href);
    if (!videoId) return null;
    const video = youtubeVideosById.get(videoId);
    if (!video) return null;
    return { ...video, id: row.id, href: row.href };
}

// Builds a custom row's video from its own metadata; null when its title, thumbnail or alt text is missing.
function toCustomHomepageVideo(row: HomepageVideoRow): HomepageVideo | null {
    if (!row.title || !row.thumbnail || !row.thumbnail_alt) return null;
    return {
        id: row.id,
        href: row.href,
        title: row.title,
        description: row.description,
        thumbnail: row.thumbnail,
        thumbnailAlt: row.thumbnail_alt,
        category: row.category,
        duration: row.duration,
        description_translation_key: row.description_translation_key,
        thumbnail_alt_translation_key: row.thumbnail_alt_translation_key,
        category_translation_key: row.category_translation_key,
    };
}
