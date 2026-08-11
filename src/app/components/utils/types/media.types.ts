export type ChannelVideo = {
    href: string;
};

export type YouTubeVideo = {
    id: string;
    title: string;
    description: string;
    thumbnail: string;
    thumbnailAlt: string;
    href: string;
    category: string;
    duration: string | null;
};

export type ContentCreator = {
    channelId: string;
};

export type YouTubeCreator = {
    id: string;
    name: string;
    description: string;
    avatar: string | null;
    href: string;
};