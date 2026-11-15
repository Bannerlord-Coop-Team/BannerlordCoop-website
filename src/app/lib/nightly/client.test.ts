import assert from "node:assert/strict";
import test from "node:test";
import { createNightlyClient, decodeOAuthOutcome, decodePortal, isSessionRejection, toPendingClaim, type NightlyFetch } from "./client";
import { readNightlyConfig } from "./config";
import type { NightlyLogger } from "./diagnostics";

const config = { functionUrl: "https://project.supabase.co/functions/v1/nightly-gateway", websiteKey: "website-key-value" };
const SESSION = "A".repeat(43);
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

type Captured = { url: string; init: RequestInit };

/** Builds a fake fetch that records calls and answers with a fixed response. */
function fakeFetch(status: number, body?: unknown): { fetch: NightlyFetch; calls: Captured[] } {
    const calls: Captured[] = [];
    const fetch: NightlyFetch = async (url, init) => {
        calls.push({ url, init });
        const text = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
        return new Response(text, { status });
    };
    return { fetch, calls };
}

test("every call is an authenticated JSON POST to the contract route with the contract body", async () => {
    const cases: Array<[string, (client: ReturnType<typeof createNightlyClient>) => Promise<unknown>, string, unknown]> = [
        ["device start", (c) => c.startDeviceOAuth("ABCD-EF23"), "/oauth/start", { purpose: "device", user_code: "ABCD-EF23" }],
        ["sponsor start", (c) => c.startSponsorOAuth(), "/oauth/start", { purpose: "sponsor-portal" }],
        ["complete", (c) => c.completeOAuth("discord-code", "state"), "/oauth/complete", { code: "discord-code", state: "state" }],
        ["claim", (c) => c.claimSponsorship("device-1", "AAAA-BBBB-CCCC"), "/sponsorship/claim", { device_id: "device-1", sponsor_code: "AAAA-BBBB-CCCC" }],
        ["portal", (c) => c.sponsorPortal(SESSION), "/sponsor/portal", { session: SESSION }],
        ["code", (c) => c.createSponsorCode(SESSION), "/sponsor/code", { session: SESSION }],
        ["remove", (c) => c.removeSponsoredAccount(SESSION, "123456789012345678"), "/sponsor/remove", { session: SESSION, discord_user_id: "123456789012345678" }],
    ];
    for (const [name, invoke, path, body] of cases) {
        const { fetch, calls } = fakeFetch(500, { error: "internal_error" });
        await invoke(createNightlyClient(config, fetch));
        assert.equal(calls.length, 1, name);
        const [{ url, init }] = calls;
        assert.equal(url, `${config.functionUrl}${path}`, name);
        assert.equal(init.method, "POST", name);
        assert.equal(init.cache, "no-store", name);
        assert.equal(init.redirect, "manual", name);
        const headers = new Headers(init.headers);
        assert.equal(headers.get("x-nightly-website-key"), "website-key-value", name);
        assert.equal(headers.get("content-type"), "application/json", name);
        assert.deepEqual(JSON.parse(String(init.body)), body, name);
    }
});

test("contract error codes pass through with their HTTP status", async () => {
    const cases: Array<[number, string]> = [
        [400, "invalid_code"], [400, "expired"], [403, "invalid_sponsor_code"], [403, "supporter_role_required"],
        [409, "already_sponsored"], [409, "seats_full"], [401, "authorization_expired"], [502, "discord_membership_required"],
    ];
    for (const [status, code] of cases) {
        const { fetch } = fakeFetch(status, { error: code, upstream_status: 403, upstream_code: 50001 });
        assert.deepEqual(await createNightlyClient(config, fetch).claimSponsorship("d", "c"), { ok: false, status, code });
    }
});

test("raw or malformed upstream bodies never become user-visible codes", async () => {
    const bodies: unknown[] = ["<html>Cloudflare error</html>", { error: "<script>alert(1)</script>" }, { error: 42 }, undefined, "x".repeat(70_000)];
    for (const body of bodies) {
        const { fetch } = fakeFetch(502, body);
        assert.deepEqual(await createNightlyClient(config, fetch).sponsorPortal(SESSION), { ok: false, status: 502, code: "http_502" });
    }
});

test("network failures, missing configuration and contract-breaking success bodies fail closed", async () => {
    const throwing: NightlyFetch = async () => { throw new TypeError("network down"); };
    assert.deepEqual(await createNightlyClient(config, throwing).startSponsorOAuth(), { ok: false, status: 0, code: "unavailable" });

    const unused = fakeFetch(200, {});
    assert.deepEqual(await createNightlyClient(null, unused.fetch).startSponsorOAuth(), { ok: false, status: 0, code: "not_configured" });
    assert.equal(unused.calls.length, 0);

    const { fetch } = fakeFetch(200, { code: "not-a-sponsor-code" });
    assert.deepEqual(await createNightlyClient(config, fetch).createSponsorCode(SESSION), { ok: false, status: 200, code: "invalid_response" });
});

/** Builds a logger that records every entry it is given. */
function recordingLogger(): { log: NightlyLogger; entries: Array<Readonly<Record<string, string | number>>> } {
    const entries: Array<Readonly<Record<string, string | number>>> = [];
    return { log: (entry) => entries.push(entry), entries };
}

test("each failed call is logged once with its route, never with bodies or secrets", async () => {
    const unreachable = recordingLogger();
    const timingOut: NightlyFetch = async () => { throw new DOMException(`timed out ${config.websiteKey}`, "TimeoutError"); };
    assert.deepEqual(await createNightlyClient(config, timingOut, unreachable.log).sponsorPortal(SESSION), { ok: false, status: 0, code: "unavailable" });
    assert.deepEqual(unreachable.entries, [{ event: "nightly_function_unreachable", path: "/sponsor/portal", error: "TimeoutError" }]);

    const failed = recordingLogger();
    const serverError = fakeFetch(503, { error: "discord_unavailable", detail: SESSION });
    assert.deepEqual(await createNightlyClient(config, serverError.fetch, failed.log).createSponsorCode(SESSION), { ok: false, status: 503, code: "discord_unavailable" });
    assert.deepEqual(failed.entries, [{ event: "nightly_function_failed", path: "/sponsor/code", status: 503, code: "discord_unavailable" }]);

    const invalid = recordingLogger();
    const breaking = fakeFetch(200, { code: "not-a-sponsor-code" });
    assert.deepEqual(await createNightlyClient(config, breaking.fetch, invalid.log).createSponsorCode(SESSION), { ok: false, status: 200, code: "invalid_response" });
    assert.deepEqual(invalid.entries, [{ event: "nightly_function_invalid_response", path: "/sponsor/code" }]);

    const logged = JSON.stringify([unreachable.entries, failed.entries, invalid.entries]);
    assert.ok(!logged.includes(config.websiteKey) && !logged.includes(SESSION), logged);
});

test("a success reply whose body cannot be read is an invalid response logged with the read error's class", async () => {
    const { log, entries } = recordingLogger();
    const brokenStream = new ReadableStream({ start: (controller) => controller.error(new TypeError("stream reset")) });
    const breaking: NightlyFetch = async () => new Response(brokenStream, { status: 200 });
    const result = await createNightlyClient(config, breaking, log).removeSponsoredAccount(SESSION, "123456789012345678");
    assert.deepEqual(result, { ok: false, status: 200, code: "invalid_response" });
    assert.deepEqual(entries, [{ event: "nightly_function_invalid_response", path: "/sponsor/remove", error: "TypeError" }]);
});

test("client errors are not logged: they are expected outcomes the pages explain", async () => {
    const { log, entries } = recordingLogger();
    const expired = fakeFetch(401, { error: "authorization_expired" });
    await createNightlyClient(config, expired.fetch, log).sponsorPortal(SESSION);
    assert.deepEqual(entries, []);
});

test("a rejected website key is logged so it does not pass for an expired session", async () => {
    const { log, entries } = recordingLogger();
    const rejected = fakeFetch(401, { error: "unauthorized" });
    const result = await createNightlyClient(config, rejected.fetch, log).sponsorPortal(SESSION);
    assert.deepEqual(result, { ok: false, status: 401, code: "unauthorized" });
    assert.deepEqual(entries, [{ event: "nightly_function_failed", path: "/sponsor/portal", status: 401, code: "unauthorized" }]);
});

test("only a 401 with a contract session-rejection code is a session rejection; other 401s or statuses are not", () => {
    assert.equal(isSessionRejection({ ok: false, status: 401, code: "authorization_expired" }), true);
    assert.equal(isSessionRejection({ ok: false, status: 401, code: "authorization_required" }), true);
    assert.equal(isSessionRejection({ ok: false, status: 401, code: "authorization_foo" }), false);
    assert.equal(isSessionRejection({ ok: false, status: 401, code: "unauthorized" }), false);
    assert.equal(isSessionRejection({ ok: false, status: 401, code: "http_401" }), false);
    assert.equal(isSessionRejection({ ok: false, status: 403, code: "authorization_expired" }), false);
});

test("pending claims validate the device id and username, and only a literal true marks a revoked sponsor", () => {
    assert.deepEqual(toPendingClaim(DEVICE_ID, "friend", true), { deviceId: DEVICE_ID, username: "friend", previousSponsorRevoked: true });
    assert.deepEqual(toPendingClaim(DEVICE_ID, "friend", "yes"), { deviceId: DEVICE_ID, username: "friend", previousSponsorRevoked: false });
    for (const [deviceId, username] of [[42, "friend"], ["device-1", "friend"], [DEVICE_ID.toUpperCase(), "friend"], [DEVICE_ID, ""], [DEVICE_ID, 7]]) {
        assert.equal(toPendingClaim(deviceId, username, false), null, JSON.stringify([deviceId, username]));
    }
});

test("statuses the contract never sends a user are logged: a wrong function URL's 404 and an unfollowed redirect", async () => {
    const cases: Array<[number, unknown, string]> = [
        [404, { error: "not_found" }, "not_found"],
        [404, undefined, "http_404"],
        [302, undefined, "http_302"],
        [307, "<html>moved</html>", "http_307"],
    ];
    for (const [status, body, code] of cases) {
        const { log, entries } = recordingLogger();
        const result = await createNightlyClient(config, fakeFetch(status, body).fetch, log).sponsorPortal(SESSION);
        assert.deepEqual(result, { ok: false, status, code }, String(status));
        assert.deepEqual(entries, [{ event: "nightly_function_failed", path: "/sponsor/portal", status, code }], String(status));
    }
});

test("authorize URLs must point at Discord's OAuth authorize endpoint", async () => {
    const good = "https://discord.com/oauth2/authorize?client_id=1&state=abc";
    const ok = await createNightlyClient(config, fakeFetch(200, { authorize_url: good }).fetch).startDeviceOAuth("ABCD-EF23");
    assert.deepEqual(ok, { ok: true, value: good });
    for (const bad of ["https://evil.example/oauth2/authorize", "http://discord.com/oauth2/authorize", "https://discord.com.evil.example/oauth2/authorize", "https://user:pass@discord.com/oauth2/authorize", "https://discord.com/logout", "javascript:alert(1)"]) {
        const result = await createNightlyClient(config, fakeFetch(200, { authorize_url: bad }).fetch).startSponsorOAuth();
        assert.deepEqual(result, { ok: false, status: 200, code: "invalid_response" }, bad);
    }
});

test("OAuth outcomes decode exactly the four contract shapes", () => {
    assert.deepEqual(decodeOAuthOutcome({ outcome: "approved" }), { outcome: "approved" });
    assert.deepEqual(decodeOAuthOutcome({ outcome: "sponsored-approved", extra: 1 }), { outcome: "sponsored-approved" });
    assert.deepEqual(
        decodeOAuthOutcome({ outcome: "needs-sponsor", device_id: DEVICE_ID, username: "friend", previous_sponsor_revoked: true }),
        { outcome: "needs-sponsor", claim: { deviceId: DEVICE_ID, username: "friend", previousSponsorRevoked: true } },
    );
    assert.deepEqual(
        decodeOAuthOutcome({ outcome: "needs-sponsor", device_id: DEVICE_ID, username: "friend" }),
        { outcome: "needs-sponsor", claim: { deviceId: DEVICE_ID, username: "friend", previousSponsorRevoked: false } },
    );
    assert.deepEqual(decodeOAuthOutcome({ outcome: "portal", session: SESSION, expires_in: 86400 }), { outcome: "portal", session: SESSION, expires_in: 86400 });
    assert.deepEqual(decodeOAuthOutcome({ outcome: "portal", session: SESSION, expires_in: 3600.9 }), { outcome: "portal", session: SESSION, expires_in: 3600 });
    const portalExpiring = (expiresIn: unknown) => ({ outcome: "portal", session: SESSION, ...(expiresIn === undefined ? {} : { expires_in: expiresIn }) });
    const badPortals = [undefined, null, "86400", 0, -5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 1e300].map(portalExpiring);
    for (const bad of [null, [], { outcome: "unknown" }, { outcome: "portal", session: "short", expires_in: 86400 }, ...badPortals, { outcome: "needs-sponsor", device_id: "bad id!", username: "x" }, { outcome: "needs-sponsor", device_id: "device-1", username: "x" }, { outcome: "needs-sponsor", device_id: DEVICE_ID.toUpperCase(), username: "x" }, { outcome: "needs-sponsor", device_id: DEVICE_ID, username: "" }, { outcome: "needs-sponsor", device_id: DEVICE_ID, username: "x".repeat(101) }]) {
        assert.equal(decodeOAuthOutcome(bad), undefined, JSON.stringify(bad));
    }
});

test("portal seats keep valid snowflakes, read epoch-second timestamps and drop malformed rows", () => {
    const portal = decodePortal({
        seats: [
            { discord_user_id: "123456789012345678", created_at: 1_700_000_000 },
            { discord_user_id: "223456789012345678", created_at: "2026-11-01T10:00:00Z" },
            { discord_user_id: "323456789012345678" },
            { discord_user_id: "<b>not-a-snowflake</b>", created_at: 1 },
            "junk",
        ],
    });
    assert.deepEqual(portal, {
        seats: [
            { discordUserId: "123456789012345678", createdAt: new Date(1_700_000_000_000) },
            { discordUserId: "223456789012345678", createdAt: null },
            { discordUserId: "323456789012345678", createdAt: null },
        ],
    });
    assert.deepEqual(decodePortal({ seats: [] }), { seats: [] });
    assert.equal(decodePortal({ seats: "x" }), undefined);
    assert.equal(decodePortal({}), undefined);
});

test("config requires a website key and a clean https function URL", () => {
    const url = "https://project.supabase.co/functions/v1/nightly-gateway/";
    const invalidUrl = { ok: false, setting: "NIGHTLY_FUNCTION_URL" };
    const loopback = "http://127.0.0.1:54321/functions/v1/nightly-gateway";
    assert.deepEqual(readNightlyConfig({ NIGHTLY_FUNCTION_URL: url, NIGHTLY_WEBSITE_KEY: " key " }), {
        ok: true, config: { functionUrl: "https://project.supabase.co/functions/v1/nightly-gateway", websiteKey: "key" },
    });
    assert.deepEqual(readNightlyConfig({ NIGHTLY_FUNCTION_URL: url }), { ok: false, setting: "NIGHTLY_WEBSITE_KEY" });
    assert.deepEqual(readNightlyConfig({ NIGHTLY_FUNCTION_URL: url, NIGHTLY_WEBSITE_KEY: "  " }), { ok: false, setting: "NIGHTLY_WEBSITE_KEY" });
    assert.deepEqual(readNightlyConfig({ NIGHTLY_WEBSITE_KEY: "key" }), invalidUrl);
    for (const bad of ["http://project.supabase.co/x", "https://user:pw@project.supabase.co/x", "https://project.supabase.co/x?y=1", "not a url"]) {
        assert.deepEqual(readNightlyConfig({ NIGHTLY_FUNCTION_URL: bad, NIGHTLY_WEBSITE_KEY: "key" }), invalidUrl, bad);
    }
    assert.deepEqual(readNightlyConfig({ NIGHTLY_FUNCTION_URL: loopback, NIGHTLY_WEBSITE_KEY: "key" }), invalidUrl);
    assert.deepEqual(readNightlyConfig({ NIGHTLY_FUNCTION_URL: loopback, NIGHTLY_WEBSITE_KEY: "key", NODE_ENV: "development" }), {
        ok: true, config: { functionUrl: loopback, websiteKey: "key" },
    });
});
