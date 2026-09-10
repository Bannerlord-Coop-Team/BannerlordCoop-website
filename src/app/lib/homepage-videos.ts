import "server-only";
import type { MediaVideo } from "@/app/components/utils/types/media.types";
import { getYouTubeVideos } from "./youtube";

type HomepageVideoRow = {
    id: string;
    source: "youtube" | "custom";
    href: string;
    title: string | null;
    description: string;
    thumbnail: string | null;
    thumbnail_alt: string | null;
    category: string;
    duration: string | null;
};

export async function getHomepageVideos(): Promise<MediaVideo[]> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return [];

    try {
        const parameters = new URLSearchParams({
            select: "id,source,href,title,description,thumbnail,thumbnail_alt,category,duration",
            published: "eq.true",
            order: "published_at.desc.nullslast,sort_order.asc,id.asc",
        });
        const response = await fetch(`${url}/rest/v1/homepage_videos?${parameters}`, {
            headers: { apikey: key },
            next: { revalidate: 60 },
        });
        if (!response.ok) {
            throw new Error(`Homepage videos request failed with status ${response.status}.`);
        }
        const rows = (await response.json()) as HomepageVideoRow[];
        const youtubeVideos = await getYouTubeVideos(
            rows.filter((row) => row.source === "youtube").map((row) => row.href),
        );
        const byHref = new Map(youtubeVideos.map((video) => [video.href, video]));

        return rows.flatMap((row): MediaVideo[] => {
            if (row.source === "youtube") {
                // The database accepts both youtube.com and www.youtube.com URLs.
                const canonicalHref = `https://www.youtube.com/watch?v=${new URL(row.href).searchParams.get("v")}`;
                const video = byHref.get(canonicalHref);
                return video ? [{ ...video, id: row.id, href: row.href }] : [];
            }
            if (!row.title || !row.thumbnail || !row.thumbnail_alt) return [];
            return [{
                id: row.id,
                href: row.href,
                title: row.title,
                description: row.description,
                thumbnail: row.thumbnail,
                thumbnailAlt: row.thumbnail_alt,
                category: row.category,
                duration: row.duration,
            }];
        });
    } catch (error) {
        console.error("Unable to retrieve homepage videos.", error);
        return [];
    }
}
