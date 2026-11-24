import assert from "node:assert/strict";
import test from "node:test";
import "../server-only.test-utils.mjs";

const { fetchPublicRows } = await import("./public-rows.ts");

const project = { url: "https://example.supabase.co", key: "public-test-key" };

// Returns a fetch stand-in that answers every request with the given response and records each request.
function recordingFetcher(respond) {
    const requests = [];
    const fetcher = async (input, init) => {
        requests.push({ url: new URL(String(input)), init });
        return respond();
    };
    return { fetcher, requests };
}

test("requests the table with the query, publishable key and 60-second revalidation", async () => {
    const { fetcher, requests } = recordingFetcher(() => Response.json([{ id: "row" }]));
    assert.deepEqual(await fetchPublicRows("things", { select: "id", order: "id.asc" }, { ...project, fetchImplementation: fetcher }), [{ id: "row" }]);
    assert.equal(requests.length, 1);
    const [{ url, init }] = requests;
    assert.equal(url.origin + url.pathname, "https://example.supabase.co/rest/v1/things");
    assert.deepEqual(Object.fromEntries(url.searchParams), { select: "id", order: "id.asc" });
    assert.equal(new Headers(init.headers).get("apikey"), "public-test-key");
    assert.equal(init.next.revalidate, 60);
});

test("returns no rows and logs the table and status on an error response", async (context) => {
    const error = context.mock.method(console, "error", () => {});
    const { fetcher } = recordingFetcher(() => new Response(null, { status: 503 }));
    assert.deepEqual(await fetchPublicRows("things", {}, { ...project, fetchImplementation: fetcher }), []);
    assert.equal(error.mock.callCount(), 1);
    assert.match(error.mock.calls[0].arguments[0], /things.*503/);
});

test("returns no rows and logs the table on a network failure", async (context) => {
    const error = context.mock.method(console, "error", () => {});
    const { fetcher } = recordingFetcher(() => { throw new TypeError("fetch failed"); });
    assert.deepEqual(await fetchPublicRows("things", {}, { ...project, fetchImplementation: fetcher }), []);
    assert.equal(error.mock.callCount(), 1);
    assert.match(error.mock.calls[0].arguments[0], /things/);
});

for (const missing of ["url", "key"]) {
    test(`returns no rows without fetching when the project ${missing} is unset`, async () => {
        const fetcher = async () => assert.fail("Must not fetch without config");
        assert.deepEqual(await fetchPublicRows("things", {}, { ...project, [missing]: undefined, fetchImplementation: fetcher }), []);
    });
}
