import assert from "node:assert/strict";
import test from "node:test";
import { isRemoteImageAllowed, remoteImagePatterns } from "./remote-image-hosts";

test("lists only exact hostnames, which the literal matcher can compare", () => {
    for (const { hostname } of remoteImagePatterns) {
        assert.match(hostname, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
});

test("allows HTTPS images on configured hosts", () => {
    assert.equal(isRemoteImageAllowed("https://static-cdn.jtvnw.net/jtv_user_pictures/a.png"), true);
    assert.equal(isRemoteImageAllowed("https://yt3.ggpht.com/a.jpg"), true);
});

test("rejects other hosts, plain HTTP and unparsable URLs", () => {
    assert.equal(isRemoteImageAllowed("https://example.com/a.png"), false);
    assert.equal(isRemoteImageAllowed("https://static-cdn.jtvnw.net.example.com/a.png"), false);
    assert.equal(isRemoteImageAllowed("http://static-cdn.jtvnw.net/a.png"), false);
    assert.equal(isRemoteImageAllowed("not a url"), false);
});
