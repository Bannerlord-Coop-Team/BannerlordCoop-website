import { beforeEach, expect, it, vi } from "vitest";

import { getGitHubReleases } from "./github-releases";

const release = (id: number) => ({ id, tag_name: `v${id}`, html_url: `https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases/tag/v${id}`, published_at: "2026-11-18T00:00:00Z", draft: false });

beforeEach(() => vi.restoreAllMocks());

it("follows GitHub pages past one hundred releases and uses the versioned cache key", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = new URL(String(input));
        const page = Number(url.searchParams.get("page"));
        return Response.json(page === 1 ? Array.from({ length: 100 }, (_, index) => release(index)) : [release(100)]);
    });
    const result = await getGitHubReleases();
    expect(result.releases).toHaveLength(101);
    expect(result.hasMore).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("per_page=100");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("cache_key=2");
});

it("stops after the fixed page budget and reports that the archive continues", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(Array.from({ length: 100 }, (_, index) => release(index))));
    const result = await getGitHubReleases();
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result.releases).toHaveLength(500);
    expect(result.hasMore).toBe(true);
});
