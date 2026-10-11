import assert from "node:assert/strict";
import test from "node:test";

import { getDevAuthEmail } from "./dev-auth";

test("allows debug sign-in only in development on loopback with an email configured", () => {
    assert.equal(getDevAuthEmail({ NODE_ENV: "development", DEV_AUTH_EMAIL: " dev@example.com " }, "localhost"), "dev@example.com");
    assert.equal(getDevAuthEmail({ NODE_ENV: "development", DEV_AUTH_EMAIL: "dev@example.com" }, "127.0.0.1"), "dev@example.com");
    assert.equal(getDevAuthEmail({ NODE_ENV: "production", DEV_AUTH_EMAIL: "dev@example.com" }, "localhost"), null);
    assert.equal(getDevAuthEmail({ NODE_ENV: "development", DEV_AUTH_EMAIL: "dev@example.com" }, "bannerlordcoop.com"), null);
    assert.equal(getDevAuthEmail({ NODE_ENV: "development", DEV_AUTH_EMAIL: "dev@example.com" }, "192.168.56.1"), null);
    assert.equal(getDevAuthEmail({ NODE_ENV: "development", DEV_AUTH_EMAIL: " " }, "localhost"), null);
    assert.equal(getDevAuthEmail({ NODE_ENV: "development" }, "localhost"), null);
});
