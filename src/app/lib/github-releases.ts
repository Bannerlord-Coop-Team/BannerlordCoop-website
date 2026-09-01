import "server-only"

const GITHUB_OWNER = "Bannerlord-Coop-Team";
const GITHUB_REPO = "BannerlordCoop";
const RELEASE_LIMIT = 20;

export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

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
}

export async function getGitHubReleases(): Promise<GitHubReleaseResult> {
    const parameters = new URLSearchParams({per_page: String(RELEASE_LIMIT), page: "1",});
    const githubToken = process.env.GITHUB_TOKEN?.trim();

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "BannerlordCoop-Website",
    };

    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

    try {
        const response = await fetch(
            `${GITHUB_RELEASES_API_URL}?${parameters}`,
            {
                headers,
                next: {
                    revalidate: 3600,
                },
            },
        );

        if (!response.ok) {console.error(`GitHub releases request failed with status ${response.status}.`,);return {releases: [], isAvailable: false,};
        }

        const data = (await response.json()) as unknown;

        if (!Array.isArray(data)) {
            console.error("GitHub releases request returned an unexpected response.");
            return {releases: [], isAvailable: false,};
        }

        const releases = data.flatMap((value): GitHubRelease[] => {
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
        });

        return {releases, isAvailable: true,};
    } catch (error) {
        console.error("Unable to retrieve GitHub releases.", error);
        return {releases: [], isAvailable: false,};
    }
}