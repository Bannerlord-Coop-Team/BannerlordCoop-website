import assert from "node:assert/strict";
import test from "node:test";
import { getSafeDestination } from "./redirect";

const origin = "https://bannerlord-coop.example";

test("allows same-origin application paths", () => {
    const destination = getSafeDestination("/campaign?tab=warband#members", origin);

    assert.equal(
        destination.href,
        "https://bannerlord-coop.example/campaign?tab=warband#members",
    );
});

test("rejects external and scheme-relative destinations", () => {
    const unsafeDestinations = [
        "https://evil.test/path",
        "//evil.test/path",
        "/\\evil.test/path",
        "https://bannerlord-coop.example//evil.test/path",
    ];

    for (const value of unsafeDestinations) {
        assert.equal(getSafeDestination(value, origin).href, `${origin}/`);
    }
});
