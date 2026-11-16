import assert from "node:assert/strict";
import test from "node:test";
import { sameOriginRequest, sameOriginSubmission } from "./same-origin";

test("same-origin submissions require matching Fetch Metadata or Origin", () => {
    const check = (values: Record<string, string>) => sameOriginSubmission(new Headers(values));
    assert.equal(check({ "sec-fetch-site": "same-origin", origin: "https://bannerlordcoop.com", host: "bannerlordcoop.com" }), true);
    assert.equal(check({ origin: "https://bannerlordcoop.com", host: "bannerlordcoop.com" }), true);
    assert.equal(check({ "sec-fetch-site": "same-origin", host: "bannerlordcoop.com" }), true);
    assert.equal(check({ origin: "https://bannerlordcoop.com", "x-forwarded-host": "bannerlordcoop.com, proxy", host: "internal" }), true);
    assert.equal(check({ "sec-fetch-site": "cross-site", origin: "https://bannerlordcoop.com", host: "bannerlordcoop.com" }), false);
    assert.equal(check({ "sec-fetch-site": "same-site", origin: "https://nightly.bannerlordcoop.com", host: "bannerlordcoop.com" }), false);
    assert.equal(check({ origin: "https://evil.example", host: "bannerlordcoop.com" }), false);
    assert.equal(check({ origin: "null", host: "bannerlordcoop.com" }), false);
    assert.equal(check({ host: "bannerlordcoop.com" }), false);
    assert.equal(check({ "sec-fetch-site": "none", host: "bannerlordcoop.com" }), false);
    assert.equal(check({ "sec-fetch-site": "same-origin", origin: "https://bannerlordcoop.com" }), false);
});

test("route-handler requests keep accepting direct navigations and Origin-less requests", () => {
    const check = (values: Record<string, string>) => sameOriginRequest(new Request("https://bannerlordcoop.com/api/x", { headers: values }));
    assert.equal(check({}), true);
    assert.equal(check({ "sec-fetch-site": "none" }), true);
    assert.equal(check({ "sec-fetch-site": "same-origin", origin: "https://bannerlordcoop.com" }), true);
    assert.equal(check({ origin: "http://bannerlordcoop.com" }), false);
    assert.equal(check({ "sec-fetch-site": "cross-site" }), false);
});
