// @vitest-environment node
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./page";
import { getNetworkStats, type NetworkStats } from "./lib/network-stats";
import { LocalizationProvider } from "./lib/localization/client";
import common from "./lib/localization/dictionaries/en/common.json";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
vi.mock("@/app/lib/network-stats", () => ({ getNetworkStats: vi.fn() }));
vi.mock("@/app/lib/roadmap", () => ({ getRoadmap: async () => [] }));
vi.mock("@/app/lib/homepage-videos", () => ({ getHomepageVideos: async () => [] }));
vi.mock("@/app/lib/youtube", () => ({ getYouTubeCreators: async () => [] }));

afterEach(() => vi.resetAllMocks());

describe("homepage statistics streaming", () => {
    it.each([
        { playersOnline: 12345, dedicatedServersCount: 0, battlesFoughtTotal: null, totalDownloads: 67890 },
        { playersOnline: null, dedicatedServersCount: null, battlesFoughtTotal: null, totalDownloads: null },
    ])("streams useful HTML while statistics are pending, then completes with %j", async (stats) => {
        let release!: (value: NetworkStats) => void;
        vi.mocked(getNetworkStats).mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const output = new PassThrough();
        let html = "";
        output.on("data", (chunk) => { html += chunk.toString(); });
        const finished = new Promise<void>((resolve, reject) => { output.on("end", resolve); output.on("error", reject); });
        const errors: unknown[] = [];
        let renderer: ReturnType<typeof renderToPipeableStream> | undefined;
        try {
            await new Promise<void>((resolve, reject) => {
                renderer = renderToPipeableStream(<LocalizationProvider locale="en" messages={{ common }}><Home /></LocalizationProvider>, {
                    onShellReady() { renderer!.pipe(output); resolve(); },
                    onShellError: reject,
                    onError(error) { errors.push(error); },
                });
            });
            expect(getNetworkStats).toHaveBeenCalledOnce();
            expect(html).toContain("<header");
            expect(html).toContain('aria-label="Primary navigation"');
            expect(html).toContain('id="hero-heading"');
            expect(html).toContain("Forge Alliances");
            expect(html).toContain('aria-haspopup="dialog"');
            expect(html).toContain("Rent a Server");
            expect(html).toContain('aria-busy="true"');
            expect(html).not.toContain("12,345");
            expect(output.readableEnded).toBe(false);
            const shellLength = html.length;
            release(stats);
            await finished;
            const completion = html.slice(shellLength);
            expect(completion).toContain('aria-busy="false"');
            expect(completion).toContain(stats.playersOnline === null ? "Not available" : "12,345");
            expect(errors).toEqual([]);
        } finally {
            renderer?.abort();
            output.destroy();
        }
    });
});
