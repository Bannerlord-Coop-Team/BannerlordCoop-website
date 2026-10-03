import { afterEach, describe, expect, it, vi } from "vitest";
import { getYouTubeVideos, type YouTubeLabels } from "./youtube";
import { getHomepageVideos } from "./homepage-videos";

const href = "https://www.youtube.com/watch?v=Au-oT5KKj0w";
const labels: YouTubeLabels = {
    fallbackTitle: "Localized fallback",
    // Marks only site-generated thumbnail prose, preserving its source title token.
    videoThumbnail: (title) => `Localized video: ${title}`,
    // Marks the separate fallback-thumbnail presentation path.
    fallbackThumbnail: (title) => `Localized fallback: ${title}`,
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// Matrix: API/oEmbed metadata and failures; keyed/unkeyed custom media retain source values and order.
describe("homepage generated media labels", () => {
    it("preserves API titles/descriptions/categories, even a title identical to the default fallback", async () => {
        vi.stubEnv("YOUTUBE_API_KEY", "test-key");
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{
            id: "Au-oT5KKj0w", snippet: { title: "Bannerlord Coop Video", description: "External description", channelTitle: "External category", thumbnails: { high: { url: "https://example.com/thumbnail" } } }, contentDetails: { duration: "PT2M3S" },
        }] }) });
        vi.stubGlobal("fetch", fetcher);
        expect(await getYouTubeVideos([href], labels)).toEqual([{
            id: "Au-oT5KKj0w", title: "Bannerlord Coop Video", description: "External description", category: "External category", duration: "2:03", href,
            thumbnail: "https://example.com/thumbnail", thumbnailAlt: "Localized video: Bannerlord Coop Video",
        }]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0][1]).toEqual({ next: { revalidate: 86400 } });
    });

    it.each(["External oEmbed title", ""])("injects only generated oEmbed copy with source title %j", async (title) => {
        vi.stubEnv("YOUTUBE_API_KEY", "");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title, author_name: "Source creator" }) }));
        const [video] = await getYouTubeVideos([href], labels);
        expect(video.title).toBe(title || labels.fallbackTitle);
        expect(video.category).toBe("Source creator");
        expect(video.thumbnailAlt).toBe(`Localized video: ${title || labels.fallbackTitle}`);
    });

    it("retains default English compatibility and injects localized copy when oEmbed fails", async () => {
        vi.stubEnv("YOUTUBE_API_KEY", "");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
        const [localized] = await getYouTubeVideos([href], labels);
        const [english] = await getYouTubeVideos([href]);
        expect(localized.title).toBe("Localized fallback");
        expect(localized.thumbnailAlt).toBe("Localized fallback: Localized fallback");
        expect(english.title).toBe("Bannerlord Coop Video");
        expect(english.thumbnailAlt).toBe("Bannerlord Coop Video thumbnail");
        expect(localized.href).toBe(href);
    });

    // Checks key transport without translating source fields or changing the existing media request.
    it.each([false, true])("preserves custom sources/order and passes explicit editorial keys (keyed: %s)", async (keyed) => {
        const editorialKeys = {
            description_translation_key: keyed ? "media.captainfracas-twitch.description" : null,
            thumbnail_alt_translation_key: keyed ? "media.captainfracas-twitch.thumbnailAlt" : null,
            category_translation_key: keyed ? "media.captainfracas-twitch.category" : null,
        };
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public");
        vi.stubEnv("YOUTUBE_API_KEY", "");
        const fetcher = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => [
                { id: "custom", source: "custom", title: "Custom title", description: "Custom prose", thumbnail: "https://example.com/image", thumbnail_alt: "Custom alternative", category: "Custom category", duration: "1:05", href: "https://example.com/video", ...editorialKeys },
                { id: "youtube", source: "youtube", href: `${href}&t=10s` },
            ] })
            .mockResolvedValueOnce({ ok: false });
        vi.stubGlobal("fetch", fetcher);
        const videos = await getHomepageVideos(labels);
        expect(videos).toEqual([
            { id: "custom", title: "Custom title", description: "Custom prose", thumbnail: "https://example.com/image", thumbnailAlt: "Custom alternative", category: "Custom category", duration: "1:05", href: "https://example.com/video", ...editorialKeys },
            expect.objectContaining({ id: "youtube", title: "Localized fallback", href: `${href}&t=10s` }),
        ]);
        const query = new URL(fetcher.mock.calls[0][0]).searchParams;
        expect(query.get("order")).toBe("published_at.desc.nullslast,sort_order.asc,id.asc");
        expect(query.get("published")).toBe("eq.true");
        expect(query.get("select")?.split(",")).toEqual(expect.arrayContaining(Object.keys(editorialKeys)));
        expect(fetcher.mock.calls[0][1]).toEqual({ headers: { apikey: "test-public" }, next: { revalidate: 60 } });
    });
});
