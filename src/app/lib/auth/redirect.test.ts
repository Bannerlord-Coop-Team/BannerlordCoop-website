import assert from "node:assert/strict";
import test from "node:test";
import { getLoginRedirect, getSafeDestination } from "./redirect";

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

test("rejects control characters before URL parsing can silently remove or normalize them", () => {
    for (const value of ["/admin\r\n", "/admin\t", "/admin?tab=a\nb", "/admin\u0000", "/admin\u001f", "/admin\u007f"]) {
        assert.equal(getSafeDestination(value, origin).href, `${origin}/`);
        const login = new URL(getLoginRedirect(value, {}), origin);
        assert.equal(login.searchParams.get("next"), "/");
    }
});

test("encoded separators stay path or query data and never become an external authority", () => {
    for (const value of ["/%2F%2Fevil.test/path", "/%5C%5Cevil.test/path", "/%252F%252Fevil.test/path", "/admin?q=%2F%2Fevil.test%0D%0A"]) {
        const destination = getSafeDestination(value, origin);
        assert.equal(destination.origin, origin);
        assert.equal(destination.href, new URL(value, origin).href);
        assert.doesNotMatch(destination.href, /[\r\n\t\\]/u);
    }
});

test("encodes the full admin destination and repeated query values inside one relative login next", () => {
    const login = new URL(getLoginRedirect("/admin/control-plane", {
        view: "server", serverId: "11111111-1111-4111-8111-111111111111", q: ["a & b", "//evil.test"], next: "https://evil.test", unused: undefined,
    }), origin);
    assert.equal(login.origin, origin);
    assert.equal(login.pathname, "/login");
    assert.equal(login.searchParams.size, 1);
    assert.equal(login.searchParams.get("next"), "/admin/control-plane?view=server&serverId=11111111-1111-4111-8111-111111111111&q=a+%26+b&q=%2F%2Fevil.test&next=https%3A%2F%2Fevil.test");
    const target = getSafeDestination(login.searchParams.get("next"), origin);
    assert.equal(target.origin, origin);
    assert.equal(target.pathname, "/admin/control-plane");
    assert.deepEqual(target.searchParams.getAll("q"), ["a & b", "//evil.test"]);
});

test("login redirect destinations reject absolute, scheme-relative, backslash and control-character origins", () => {
    for (const unsafe of ["https://evil.test", "//evil.test", "/\\evil.test", "/\t/evil.test", "javascript:alert(1)"]) {
        const login = new URL(getLoginRedirect(unsafe, {}), origin);
        assert.equal(login.origin, origin);
        assert.equal(login.searchParams.get("next"), "/");
    }
});
