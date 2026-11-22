import assert from "node:assert/strict";
import test from "node:test";
import "./server-only.test-utils.mjs";
import { homepageCreatorQuery, homepageCreatorTable } from "./homepage-creator-table.ts";

const { getHomepageCreators, toContentCreator } = await import("./homepage-creators.ts");

const youTubeRow = { id: "youtube-channel", source: "youtube", channel_id: "UCfirst", name: null, description: "", avatar: null, href: null };
const customRow = {
    id: "custom-streamer",
    source: "custom",
    channel_id: null,
    name: "Streamer",
    description: "Plays coop",
    avatar: "https://static-cdn.jtvnw.net/avatar.png",
    href: "https://www.twitch.tv/streamer",
};
const youTubeProfile = { id: "UCfirst", name: "Channel", description: "", avatar: null, href: "https://www.youtube.com/@channel" };

test("reads the shared table and query, then returns custom and resolved YouTube profiles in table order", async () => {
    const reads = [];
    const requestedChannels = [];
    const creators = await getHomepageCreators({
        readRows: async (table, query) => {
            reads.push({ table, query });
            return [customRow, youTubeRow];
        },
        resolveYouTubeCreators: async (channelIds) => {
            requestedChannels.push(...channelIds);
            return [youTubeProfile];
        },
    });
    assert.deepEqual(creators, [
        { id: customRow.id, name: "Streamer", description: "Plays coop", avatar: "https://static-cdn.jtvnw.net/avatar.png", href: "https://www.twitch.tv/streamer" },
        youTubeProfile,
    ]);
    assert.deepEqual(requestedChannels, ["UCfirst"]);
    // The migration test runs homepageCreatorQuery against the table; this checks the loader sends exactly that query.
    assert.deepEqual(reads, [{ table: homepageCreatorTable, query: homepageCreatorQuery }]);
});

test("drops a custom avatar on a host Next Image cannot load and logs it", (context) => {
    const warn = context.mock.method(console, "warn", () => {});
    const { profile } = toContentCreator({ ...customRow, avatar: "https://example.com/avatar.png" });
    assert.equal(profile.avatar, null);
    assert.equal(warn.mock.callCount(), 1);
    assert.ok(warn.mock.calls[0].arguments[0].includes(customRow.id));
});

test("keeps a missing custom avatar empty without logging", (context) => {
    const warn = context.mock.method(console, "warn", () => {});
    assert.equal(toContentCreator({ ...customRow, avatar: null }).profile.avatar, null);
    assert.equal(warn.mock.callCount(), 0);
});
