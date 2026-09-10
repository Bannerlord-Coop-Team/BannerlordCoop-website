import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Next supplies this marker at build time; it has no runtime behavior here.
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "server-only") {
            return nextResolve("node:assert", context);
        }
        return nextResolve(specifier, context);
    },
});
const { getHomepageVideos } = await import("./homepage-videos.ts");

test("homepage videos request newest-first dates, nulls last, and preserve database ordering", async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = { ...process.env };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-test-key";
    delete process.env.YOUTUBE_API_KEY;
    const requests = [];
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/rest/v1/")) {
            assert.equal(new Headers(init?.headers).get("apikey"), "public-test-key");
            assert.equal(new URL(url).searchParams.get("published"), "eq.true");
            assert.equal(new URL(url).searchParams.get("order"), "published_at.desc.nullslast,sort_order.asc,id.asc");
            assert.equal(init.next.revalidate, 60);
            return Response.json([
                { id: "custom", source: "custom", href: "https://www.twitch.tv/videos/1", title: "Twitch", thumbnail: "https://example.com/image.jpg", thumbnail_alt: "Twitch thumbnail", description: "Description", category: "Twitch", duration: null },
                { id: "youtube", source: "youtube", href: "https://youtube.com/watch?v=Au-oT5KKj0w&t=1615s" },
                { id: "undated", source: "custom", href: "https://www.twitch.tv/videos/2", title: "Undated", thumbnail: "https://example.com/image.jpg", thumbnail_alt: "Undated thumbnail", description: "", category: "Twitch", duration: null },
            ]);
        }
        return Response.json({ title: "YouTube", author_name: "Creator", thumbnail_url: "https://i.ytimg.com/test.jpg" });
    };
    try {
        const videos = await getHomepageVideos();
        assert.deepEqual(videos.map((video) => video.id), ["custom", "youtube", "undated"]);
        assert.equal(videos[0].thumbnailAlt, "Twitch thumbnail");
        assert.equal(videos[1].title, "YouTube");
        assert.equal(videos[1].href, "https://youtube.com/watch?v=Au-oT5KKj0w&t=1615s");
        assert.equal(requests.length, 2);

        globalThis.fetch = async () => Response.json([]);
        assert.deepEqual(await getHomepageVideos(), []);

        globalThis.fetch = async () => new Response(null, { status: 503 });
        assert.deepEqual(await getHomepageVideos(), []);

        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        globalThis.fetch = async () => { throw new Error("Must not fetch without config"); };
        assert.deepEqual(await getHomepageVideos(), []);
    } finally {
        globalThis.fetch = originalFetch;
        process.env = originalEnv;
    }
});
