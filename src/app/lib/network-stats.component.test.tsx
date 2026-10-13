// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNetworkStats } from "./network-stats";

const unavailable = { playersOnline: null, dedicatedServersCount: null, battlesFoughtTotal: null, totalDownloads: null };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stats.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
});

describe("optional network statistics", () => {
    it("preserves the endpoint, public key, revalidation and safe count parsing", async () => {
        fetchMock.mockResolvedValue(Response.json({ player_count: 0, server_count: 12, battles_fought_total: 12345, total_downloads: Number.MAX_SAFE_INTEGER }));
        expect(await getNetworkStats()).toEqual({ playersOnline: 0, dedicatedServersCount: 12, battlesFoughtTotal: 12345, totalDownloads: Number.MAX_SAFE_INTEGER });
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://stats.example.test/functions/v1/network-stats-cached", {
            headers: { apikey: "test-publishable-key" }, next: { revalidate: 15 }, signal: expect.any(AbortSignal),
        });
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    });

    it("keeps invalid and missing counts unavailable instead of coercing them to zero", async () => {
        fetchMock.mockResolvedValue(Response.json({ player_count: -1, server_count: "12", battles_fought_total: 1.5, total_downloads: Number.MAX_SAFE_INTEGER + 1 }));
        expect(await getNetworkStats()).toEqual(unavailable);
        fetchMock.mockResolvedValue(Response.json({ player_count: 7 }));
        expect(await getNetworkStats()).toEqual({ ...unavailable, playersOnline: 7 });
    });

    it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])("skips the fetch when %s is missing", async (name) => {
        vi.stubEnv(name, "");
        expect(await getNetworkStats()).toEqual(unavailable);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns unavailable for HTTP, malformed JSON and transport failures", async () => {
        fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
        fetchMock.mockResolvedValueOnce(new Response("not json"));
        fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
        for (let attempt = 0; attempt < 3; attempt++) expect(await getNetworkStats()).toEqual(unavailable);
    });

    it.each(["headers", "body"])("aborts stalled response %s after three seconds", async (phase) => {
        fetchMock.mockImplementation(async (_url, init) => {
            const pending = new Promise<never>((_resolve, reject) => {
                init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
            });
            if (phase === "headers") return pending;
            const response = new Response();
            vi.spyOn(response, "json").mockImplementation(() => pending);
            return response;
        });
        let settled = false;
        const result = getNetworkStats().then((stats) => { settled = true; return stats; });
        await vi.advanceTimersByTimeAsync(2_999);
        expect(settled).toBe(false);
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await result).toEqual(unavailable);
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    });
});
