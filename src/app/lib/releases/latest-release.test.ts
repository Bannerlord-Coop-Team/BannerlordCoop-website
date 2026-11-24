import assert from "node:assert/strict";
import test from "node:test";
import { createLatestReleaseReader, LATEST_MANIFEST_URL, planReleaseDownload, type ReleaseFetch } from "./latest-release";
import { V018_MANIFEST } from "./release-manifest.fixture";

const RELEASES_PAGE = "https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases";

// Builds a reader over a fake fetch that records its calls and collects log lines.
function readerFor(respond: () => Promise<Response>) {
    const calls: Array<{ input: string; init: Parameters<ReleaseFetch>[1] }> = [];
    const logs: string[] = [];
    const reader = createLatestReleaseReader(async (input, init) => {
        calls.push({ input, init });
        return respond();
    }, (message) => logs.push(message));
    return { reader, calls, logs };
}

test("fetches the fixed latest manifest asset with a ten-minute revalidate", async () => {
    const { reader, calls } = readerFor(async () => Response.json(V018_MANIFEST));
    assert.equal((await reader())?.tag, "v0.1.8");
    assert.equal(LATEST_MANIFEST_URL, `${RELEASES_PAGE}/latest/download/manifest.json`);
    assert.equal(calls[0]?.input, LATEST_MANIFEST_URL);
    assert.deepEqual(calls[0]?.init.next, { revalidate: 600 });
});

test("redirects each kind to its own archive", async () => {
    const { reader } = readerFor(async () => Response.json(V018_MANIFEST));
    assert.equal(await planReleaseDownload(reader, "mod"), V018_MANIFEST.client.url);
    assert.equal(await planReleaseDownload(reader, "server"), V018_MANIFEST.windows.url);
});

test("falls back to the releases page and logs when the manifest is unusable", async () => {
    const cases: Array<[string, () => Promise<Response>, RegExp]> = [
        ["http error", async () => new Response("missing", { status: 404 }), /status 404/u],
        ["oversized", async () => new Response("x".repeat(16 * 1024 + 1)), /size limit/u],
        ["invalid json", async () => new Response("{"), /SyntaxError/u],
        ["invalid manifest", async () => Response.json({ ...V018_MANIFEST, tag: "nightly" }), /validation/u],
        ["network failure", async () => { throw new TypeError("fetch failed"); }, /TypeError/u],
    ];
    for (const [label, respond, logged] of cases) {
        const { reader, logs } = readerFor(respond);
        assert.equal(await planReleaseDownload(reader, "mod"), RELEASES_PAGE, label);
        assert.match(logs.join("\n"), logged, label);
    }
});
