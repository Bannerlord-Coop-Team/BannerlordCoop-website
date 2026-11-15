import assert from "node:assert/strict";
import test from "node:test";
import type { NightlyClient, NightlyResult, OAuthOutcome } from "./client";
import { decodeClaimContext, encodeClaimContext, readSponsorSession } from "./cookies";
import { planActivate, planCallback, planOutcome, planSponsorLogin, planSponsorLogout, redirectResponse } from "./routes";

const SESSION = "s".repeat(43);
const STATE = "t".repeat(43);
const AUTHORIZE = "https://discord.com/oauth2/authorize?state=x";

/** Builds a client stub whose methods fail loudly unless a test overrides them. */
function stubClient(overrides: Partial<NightlyClient>): NightlyClient {
    const unexpected = async (): Promise<never> => { throw new Error("unexpected call"); };
    return {
        startDeviceOAuth: unexpected, startSponsorOAuth: unexpected, completeOAuth: unexpected, claimSponsorship: unexpected,
        sponsorPortal: unexpected, createSponsorCode: unexpected, removeSponsoredAccount: unexpected,
        ...overrides,
    };
}

/** Wraps a value as a successful client result. */
function ok<T>(value: T): NightlyResult<T> {
    return { ok: true, value };
}

test("activate normalizes the installer code, starts device OAuth and redirects to Discord", async () => {
    const codes: string[] = [];
    const client = stubClient({ startDeviceOAuth: async (code) => { codes.push(code); return ok(AUTHORIZE); } });
    assert.deepEqual(await planActivate(new URLSearchParams({ code: " abcd-ef23 " }), client), { location: AUTHORIZE, cookies: [] });
    assert.deepEqual(codes, ["ABCD-EF23"]);
});

test("activate shows the invalid or expired code page", async () => {
    const client = stubClient({});
    for (const code of ["", "ABCD", "ABCD-EF01", "<script>"]) {
        assert.equal((await planActivate(new URLSearchParams({ code }), client)).location, "/nightly/error?context=activate&code=invalid_code");
    }
    const expired = stubClient({ startDeviceOAuth: async () => ({ ok: false, status: 400, code: "expired" }) });
    assert.equal((await planActivate(new URLSearchParams({ code: "ABCD-EF23" }), expired)).location, "/nightly/error?context=activate&code=expired");
});

test("sponsor login redirects to Discord or to the error page", async () => {
    assert.equal((await planSponsorLogin(stubClient({ startSponsorOAuth: async () => ok(AUTHORIZE) }))).location, AUTHORIZE);
    const down = stubClient({ startSponsorOAuth: async () => ({ ok: false, status: 0, code: "unavailable" }) });
    assert.equal((await planSponsorLogin(down)).location, "/nightly/error?context=sponsor-login&code=unavailable");
});

test("callback rejects malformed Discord parameters without calling the Edge Function", async () => {
    const client = stubClient({});
    const malformed: Record<string, string>[] = [{}, { code: "c" }, { state: STATE }, { code: "c", state: "short" }, { code: "x".repeat(513), state: STATE }, { error: "access_denied", state: STATE }];
    for (const params of malformed) {
        assert.equal((await planCallback(new URLSearchParams(params), client)).location, "/nightly/error?context=callback&code=invalid_request");
    }
});

test("callback forwards the code and state once and maps failures to the callback error page", async () => {
    const calls: string[][] = [];
    const client = stubClient({ completeOAuth: async (code, state) => { calls.push([code, state]); return { ok: false, status: 502, code: "discord_unavailable" }; } });
    const plan = await planCallback(new URLSearchParams({ code: "discord-code", state: STATE }), client);
    assert.deepEqual(calls, [["discord-code", STATE]]);
    assert.deepEqual(plan, { location: "/nightly/error?context=callback&code=discord_unavailable", cookies: [] });
});

test("each OAuth outcome maps to its page and cookies", () => {
    assert.deepEqual(planOutcome({ outcome: "approved" }), { location: "/nightly/approved", cookies: [] });
    assert.deepEqual(planOutcome({ outcome: "sponsored-approved" }), { location: "/nightly/approved?via=sponsor", cookies: [] });
    assert.deepEqual(planOutcome({ outcome: "portal", session: SESSION, expires_in: 86400 }), {
        location: "/nightly/sponsor",
        cookies: [`nightly_sponsor=${SESSION}; Path=/nightly; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`],
    });
    const needsSponsor: OAuthOutcome = { outcome: "needs-sponsor", device_id: "device-1", username: "Fréd <b>", previous_sponsor_revoked: true };
    const plan = planOutcome(needsSponsor);
    assert.equal(plan.location, "/nightly/claim");
    assert.equal(plan.cookies.length, 1);
    const match = /^nightly_claim=([A-Za-z0-9_-]+); Path=\/nightly; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/u.exec(plan.cookies[0]!);
    assert.ok(match, plan.cookies[0]);
    assert.deepEqual(decodeClaimContext(match[1]), { deviceId: "device-1", username: "Fréd <b>", previousSponsorRevoked: true });
});

test("logout expires the sponsor cookie and marks the login prompt as expired", () => {
    assert.deepEqual(planSponsorLogout(), {
        location: "/nightly/sponsor?session=expired",
        cookies: ["nightly_sponsor=; Path=/nightly; HttpOnly; Secure; SameSite=Lax; Max-Age=0"],
    });
});

test("redirect responses are no-store 302s on the request origin with every cookie", () => {
    const response = redirectResponse({ location: "/nightly/sponsor", cookies: ["a=1", "b=2"] }, "https://bannerlordcoop.com/nightly/callback?code=x");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://bannerlordcoop.com/nightly/sponsor");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(response.headers.getSetCookie(), ["a=1", "b=2"]);
    assert.equal(redirectResponse({ location: AUTHORIZE, cookies: [] }, "https://bannerlordcoop.com/nightly/activate").headers.get("location"), AUTHORIZE);
});

test("cookie readers reject tampered values", () => {
    assert.equal(readSponsorSession(SESSION), SESSION);
    for (const bad of [undefined, "", "short", `${SESSION}x`, "s".repeat(42) + "!"]) assert.equal(readSponsorSession(bad), null);
    const encoded = encodeClaimContext({ deviceId: "d", username: "u", previousSponsorRevoked: false });
    assert.deepEqual(decodeClaimContext(encoded), { deviceId: "d", username: "u", previousSponsorRevoked: false });
    const forge = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const bad of [undefined, "", "!!!", "x".repeat(2000), forge({ d: "bad id", u: "u" }), forge({ d: "d", u: "" }), forge({ d: "d", u: "x".repeat(101) }), forge([1])]) {
        assert.equal(decodeClaimContext(bad), null, String(bad).slice(0, 40));
    }
});
