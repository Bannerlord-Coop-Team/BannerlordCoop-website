import type { ContentCreator, CreatorProfile } from "@/app/components/utils/types/media.types";

// Lists the YouTube channel IDs whose profiles must be fetched for the configured creators.
export function getYouTubeChannelIds(creators: ContentCreator[]): string[] {
    return creators.flatMap((creator) => creator.profile ? [] : [creator.channelId]);
}

// Lists creators in configured order, dropping YouTube channels whose profiles were not fetched.
export function orderCreators(creators: ContentCreator[], youTubeCreators: CreatorProfile[]): CreatorProfile[] {
    const youTubeCreatorsById = new Map(youTubeCreators.map((creator) => [creator.id, creator]));

    return creators.flatMap((creator) => {
        if (creator.profile) {
            return [creator.profile];
        }

        const profile = youTubeCreatorsById.get(creator.channelId);
        return profile ? [profile] : [];
    });
}
