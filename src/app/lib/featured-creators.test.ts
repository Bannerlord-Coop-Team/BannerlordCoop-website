import assert from "node:assert/strict";
import test from "node:test";
import type { ContentCreator, CreatorProfile } from "@/app/components/utils/types/media.types";
import { getYouTubeChannelIds, orderCreators } from "./featured-creators";

// Builds a creator profile whose fields are derived from its ID.
function profile(id: string): CreatorProfile {
    return { id, name: id, description: "", avatar: null, href: `https://example.com/${id}` };
}

const creators: ContentCreator[] = [
    { channelId: "first" },
    { profile: profile("twitch:fixed") },
    { channelId: "second" },
    { channelId: "third" },
];

test("requests only the YouTube channel IDs", () => {
    assert.deepEqual(getYouTubeChannelIds(creators), ["first", "second", "third"]);
});

test("keeps the configured order regardless of the API response order", () => {
    const ordered = orderCreators(creators, [profile("third"), profile("second"), profile("first")]);

    assert.deepEqual(ordered.map((creator) => creator.id), ["first", "twitch:fixed", "second", "third"]);
});

test("drops YouTube channels the API did not return and keeps fixed profiles", () => {
    const ordered = orderCreators(creators, [profile("second")]);

    assert.deepEqual(ordered.map((creator) => creator.id), ["twitch:fixed", "second"]);
});
