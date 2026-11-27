import "server-only"
import { GITHUB_OWNER, GITHUB_RELEASES_URL, GITHUB_REPO } from "@/app/lib/releases/repository";

const RELEASE_PAGE_SIZE = 100;
const MAXIMUM_RELEASE_PAGES = 5;
const RELEASE_CACHE_VERSION = "2";

export { GITHUB_RELEASES_URL };

const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

type GitHubReleaseResponse = {
    id?: number;
    tag_name?: string;
    name?: string | null;
    html_url?: string;
    body?: string | null;
    draft?: boolean;
    prerelease?: boolean;
    created_at?: string;
    published_at?: string | null;
    author?: { login?: string; } | null;
};

export type GitHubRelease = {
    id: number;
    tagName: string;
    name: string;
    href: string;
    body: string;
    publishedAt: string;
    author: string | null;
    prerelease: boolean;
};

export type GitHubReleaseResult = {
    releases: GitHubRelease[];
    isAvailable: boolean;
    hasMore: boolean;
}

export async function getGitHubReleases(): Promise<GitHubReleaseResult> {
    const githubToken = process.env.GITHUB_TOKEN?.trim();

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "BannerlordCoop-Website",
    };

    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

    try {
        const releases: GitHubRelease[] = [];
        let hasMore = false;
        for (let page = 1; page <= MAXIMUM_RELEASE_PAGES; page += 1) {
            const parameters = new URLSearchParams({ per_page: String(RELEASE_PAGE_SIZE), page: String(page), cache_key: RELEASE_CACHE_VERSION });
            const response = await fetch(
                `${GITHUB_RELEASES_API_URL}?${parameters}`,
                {
                    headers,
                    next: {
                        revalidate: 3600,
                    },
                },
            );

            if (!response.ok) { console.error(`GitHub releases request failed with status ${response.status}.`); return { releases: [], isAvailable: false, hasMore: false }; }

            const data = (await response.json()) as unknown;
            if (!Array.isArray(data)) {
                console.error("GitHub releases request returned an unexpected response.");
                return { releases: [], isAvailable: false, hasMore: false };
            }
            releases.push(...data.flatMap((value): GitHubRelease[] => {
            const release = value as GitHubReleaseResponse;

            if (release.draft || typeof release.id !== "number" || typeof release.tag_name !== "string" || typeof release.html_url !== "string")
            {
                return [];
            }

            const publishedAt = release.published_at ?? release.created_at;

            if (!publishedAt) return [];

            return [
                {
                    id: release.id,
                    tagName: release.tag_name,
                    name: release.name?.trim() || release.tag_name,
                    href: release.html_url,
                    body: release.body?.trim() || "",
                    publishedAt,
                    author: release.author?.login ?? null,
                    prerelease: release.prerelease === true,
                },
            ];
            }));
            if (data.length < RELEASE_PAGE_SIZE) break;
            hasMore = page === MAXIMUM_RELEASE_PAGES;
        }

        return { releases, isAvailable: true, hasMore };
    } catch (error) {
        console.error("Unable to retrieve GitHub releases.", error);
        return { releases: [], isAvailable: false, hasMore: false };
    }
}
