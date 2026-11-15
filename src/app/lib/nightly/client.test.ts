import assert from "node:assert/strict";
import test from "node:test";
import { createNightlyClient, decodeOAuthOutcome, decodePortal, type NightlyFetch } from "./client";
import { readNightlyConfig } from "./config";

const config = { functionUrl: "https://project.supabase.co/functions/v1/nightly-gateway", websiteKey: "website-key-value" };
const SESSION = "A".repeat(43);

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

test("authorize URLs must point at Discord's OAuth authorize endpoint", async () => {
    const good = "https://discord.com/oauth2/authorize?client_id=1&state=abc";
    const ok = await createNightlyClient(config, fakeFetch(200, { authorize_url: good }).fetch).startDeviceOAuth("ABCD-EF23");
    assert.deepEqual(ok, { ok: true, value: good });
    for (const bad of ["https://evil.example/oauth2/authorize", "http://discord.com/oauth2/authorize", "https://discord.com.evil.example/oauth2/authorize", "https://user:pass@discord.com/oauth2/authorize", "https://discord.com/logout", "javascript:alert(1)"]) {
        const result = await createNightlyClient(config, fakeFetch(200, { authorize_url: bad }).fetch).startSponsorOAuth();
        assert.deepEqual(result, { ok: false, status: 200, code: "invalid_response" }, bad);
    }
});

test("claim and removal succeed on their contract responses", async () => {
    const claim = await createNightlyClient(config, fakeFetch(200, { outcome: "sponsored-approved" }).fetch).claimSponsorship("d", "c");
    assert.deepEqual(claim, { ok: true, value: null });
    const removed = await createNightlyClient(config, fakeFetch(204).fetch).removeSponsoredAccount(SESSION, "123456789012345678");
    assert.deepEqual(removed, { ok: true, value: null });
    const code = await createNightlyClient(config, fakeFetch(200, { code: "AB2C-DEF3-GH45" }).fetch).createSponsorCode(SESSION);
    assert.deepEqual(code, { ok: true, value: "AB2C-DEF3-GH45" });
});

test("OAuth outcomes decode exactly the four contract shapes", () => {
    assert.deepEqual(decodeOAuthOutcome({ outcome: "approved" }), { outcome: "approved" });
    assert.deepEqual(decodeOAuthOutcome({ outcome: "sponsored-approved", extra: 1 }), { outcome: "sponsored-approved" });
    assert.deepEqual(
        decodeOAuthOutcome({ outcome: "needs-sponsor", device_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", username: "friend", previous_sponsor_revoked: true }),
        { outcome: "needs-sponsor", device_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", username: "friend", previous_sponsor_revoked: true },
    );
    assert.equal(decodeOAuthOutcome({ outcome: "needs-sponsor", device_id: "x", username: "friend" })?.outcome, "needs-sponsor");
    assert.deepEqual(decodeOAuthOutcome({ outcome: "portal", session: SESSION, expires_in: 86400 }), { outcome: "portal", session: SESSION, expires_in: 86400 });
    assert.deepEqual(decodeOAuthOutcome({ outcome: "portal", session: SESSION, expires_in: 3600.9 }), { outcome: "portal", session: SESSION, expires_in: 3600 });
    const portalExpiring = (expiresIn: unknown) => ({ outcome: "portal", session: SESSION, ...(expiresIn === undefined ? {} : { expires_in: expiresIn }) });
    const badPortals = [undefined, null, "86400", 0, -5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 1e300].map(portalExpiring);
    for (const bad of [null, [], { outcome: "unknown" }, { outcome: "portal", session: "short", expires_in: 86400 }, ...badPortals, { outcome: "needs-sponsor", device_id: "bad id!", username: "x" }, { outcome: "needs-sponsor", device_id: "d", username: "" }, { outcome: "needs-sponsor", device_id: "d", username: "x".repeat(101) }]) {
        assert.equal(decodeOAuthOutcome(bad), undefined, JSON.stringify(bad));
    }
});

test("portal seats keep valid snowflakes, accept second or ISO timestamps and drop malformed rows", () => {
    const portal = decodePortal({
        limit: 10,
        seats: [
            { discord_user_id: "123456789012345678", created_at: 1_700_000_000 },
            { discord_user_id: "223456789012345678", created_at: "2026-11-01T10:00:00Z" },
            { discord_user_id: "323456789012345678" },
            { discord_user_id: "<b>not-a-snowflake</b>", created_at: 1 },
            "junk",
        ],
    });
    assert.deepEqual(portal, {
        limit: 10,
        seats: [
            { discordUserId: "123456789012345678", createdAt: new Date(1_700_000_000_000) },
            { discordUserId: "223456789012345678", createdAt: new Date("2026-11-01T10:00:00Z") },
            { discordUserId: "323456789012345678", createdAt: null },
        ],
    });
    assert.equal(decodePortal({ seats: [] }), undefined);
    assert.equal(decodePortal({ seats: "x", limit: 10 }), undefined);
});

test("config requires a website key and a clean https function URL", () => {
    const url = "https://project.supabase.co/functions/v1/nightly-gateway/";
    assert.deepEqual(readNightlyConfig({ NIGHTLY_FUNCTION_URL: url, NIGHTLY_WEBSITE_KEY: " key " }), {
        functionUrl: "https://project.supabase.co/functions/v1/nightly-gateway", websiteKey: "key",
    });
    assert.equal(readNightlyConfig({ NIGHTLY_FUNCTION_URL: url }), null);
    assert.equal(readNightlyConfig({ NIGHTLY_WEBSITE_KEY: "key" }), null);
    for (const bad of ["http://project.supabase.co/x", "https://user:pw@project.supabase.co/x", "https://project.supabase.co/x?y=1", "not a url"]) {
        assert.equal(readNightlyConfig({ NIGHTLY_FUNCTION_URL: bad, NIGHTLY_WEBSITE_KEY: "key" }), null, bad);
    }
    assert.equal(readNightlyConfig({ NIGHTLY_FUNCTION_URL: "http://127.0.0.1:54321/functions/v1/nightly-gateway", NIGHTLY_WEBSITE_KEY: "key" }), null);
    assert.equal(
        readNightlyConfig({ NIGHTLY_FUNCTION_URL: "http://127.0.0.1:54321/functions/v1/nightly-gateway", NIGHTLY_WEBSITE_KEY: "key", NODE_ENV: "development" })?.functionUrl,
        "http://127.0.0.1:54321/functions/v1/nightly-gateway",
    );
});
