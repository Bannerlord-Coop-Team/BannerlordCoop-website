import "server-only";
import type { ContentCreator, CreatorProfile } from "@/app/components/utils/types/media.types";
import { getYouTubeChannelIds, orderCreators } from "./featured-creators";
import { homepageCreatorQuery, homepageCreatorTable, type HomepageCreatorRow } from "./homepage-creator-table";
import { isRemoteImageAllowed } from "./remote-image-hosts";
import { fetchPublicRows, type PublicRowsReader } from "./supabase/public-rows";
import { getYouTubeCreators } from "./youtube";

type CustomCreatorRow = Extract<HomepageCreatorRow, { source: "custom" }>;

// Optional overrides for the row reader and the YouTube resolver; omitted ones default to the live Supabase and YouTube calls.
// A resolver must return each profile with `id` set to its YouTube channel ID, which is how rows are matched to results.
export type HomepageCreatorDependencies = {
    readRows?: PublicRowsReader<HomepageCreatorRow>;
    resolveYouTubeCreators?: typeof getYouTubeCreators;
};

// Loads the published homepage creators as display-ready profiles in configured order, resolving YouTube channels.
export async function getHomepageCreators({
    readRows = fetchPublicRows,
    resolveYouTubeCreators = getYouTubeCreators,
}: HomepageCreatorDependencies = {}): Promise<CreatorProfile[]> {
    const rows = await readRows(homepageCreatorTable, homepageCreatorQuery);
    const creators = rows.map(toContentCreator);
    const youTubeCreators = await resolveYouTubeCreators(getYouTubeChannelIds(creators));
    return orderCreators(creators, youTubeCreators);
}

// Converts a row to a YouTube channel reference, or to a fixed profile keyed by its row id.
export function toContentCreator(row: HomepageCreatorRow): ContentCreator {
    if (row.source === "youtube") return { channelId: row.channel_id };

    return {
        profile: {
            id: row.id,
            name: row.name,
            description: row.description,
            avatar: displayableAvatar(row),
            href: row.href,
        },
    };
}

// Keeps a custom avatar only on a host Next Image can load, so a bad dashboard edit shows the initial instead of breaking.
function displayableAvatar(row: CustomCreatorRow): string | null {
    if (!row.avatar) return null;
    if (isRemoteImageAllowed(row.avatar)) return row.avatar;

    console.warn(`Homepage creator ${row.id} avatar is not on an allowed image host; showing the initial instead.`);
    return null;
}
