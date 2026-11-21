import assert from "node:assert/strict";
import test from "node:test";
import "./server-only.test-utils.mjs";

const { getHomepageVideos, toHomepageVideo } = await import("./homepage-videos.ts");

const customRow = { id: "custom", source: "custom", href: "https://www.twitch.tv/videos/1", title: "Twitch", thumbnail: "https://example.com/image.jpg", thumbnail_alt: "Twitch thumbnail", description: "Description", category: "Twitch", duration: null };
const youTubeRow = { id: "youtube", source: "youtube", href: "https://youtube.com/watch?v=Au-oT5KKj0w&t=1615s" };
const youTubeVideo = { id: "Au-oT5KKj0w", title: "YouTube", description: "", thumbnail: "https://i.ytimg.com/test.jpg", thumbnailAlt: "YouTube thumbnail", href: "https://www.youtube.com/watch?v=Au-oT5KKj0w", category: "Creator", duration: null };

test("keeps table order and resolves only the YouTube rows", async () => {
    const resolvedUrls = [];
    const videos = await getHomepageVideos(undefined, {
        readRows: async () => [customRow, youTubeRow, { ...customRow, id: "undated", title: "Undated" }],
        resolveYouTubeVideos: async (urls) => {
            resolvedUrls.push(...urls);
            return [youTubeVideo];
        },
    });
    assert.deepEqual(videos.map((video) => video.id), ["custom", "youtube", "undated"]);
    assert.deepEqual(resolvedUrls, [youTubeRow.href]);
});

test("matches a youtube.com row to its resolved video by ID and keeps the row's own href and id", () => {
    const byVideoId = new Map([[youTubeVideo.id, youTubeVideo]]);
    assert.deepEqual(toHomepageVideo(youTubeRow, byVideoId), { ...youTubeVideo, id: "youtube", href: youTubeRow.href });
});

test("skips a YouTube row whose details did not resolve", () => {
    assert.equal(toHomepageVideo(youTubeRow, new Map()), null);
});

for (const field of ["title", "thumbnail", "thumbnail_alt"]) {
    test(`skips a custom row without its ${field}`, () => {
        assert.equal(toHomepageVideo({ ...customRow, [field]: null }, new Map()), null);
    });
}
