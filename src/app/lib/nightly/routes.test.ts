import assert from "node:assert/strict";
import test from "node:test";
import type { NightlyClient, NightlyResult, OAuthOutcome } from "./client";
import { decodeClaimContext, encodeClaimContext, readSponsorSession } from "./cookies";
import { planActivate, planCallback, planOutcome, planSponsorLogin, redirectResponse } from "./routes";
import {
    errorPath,
    isSessionExpiredNotice,
    isSponsoredApproval,
    readErrorQuery,
    SESSION_EXPIRED_PATH,
    SPONSORED_APPROVED_PATH,
} from "./query-flags";

const SESSION = "s".repeat(43);
const STATE = "t".repeat(43);
const AUTHORIZE = "https://discord.com/oauth2/authorize?state=x";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const COOKIE_ATTRIBUTES = "Path=/nightly; Max-Age=0; Secure; HttpOnly; SameSite=lax";

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

test("each OAuth outcome maps to its page and cookies, and the sponsor cookie lives as long as the Edge Function says", () => {
    assert.deepEqual(planOutcome({ outcome: "approved" }), { location: "/nightly/approved", cookies: [] });
    assert.deepEqual(planOutcome({ outcome: "sponsored-approved" }), { location: "/nightly/approved?via=sponsor", cookies: [] });
    assert.deepEqual(planOutcome({ outcome: "portal", session: SESSION, expires_in: 3600 }), {
        location: "/nightly/sponsor",
        cookies: [{ name: "nightly_sponsor", value: SESSION, maxAge: 3600 }],
    });
    const claim = { deviceId: DEVICE_ID, username: "Fréd <b>", previousSponsorRevoked: true };
    const needsSponsor: OAuthOutcome = { outcome: "needs-sponsor", claim };
    const plan = planOutcome(needsSponsor);
    assert.equal(plan.location, "/nightly/claim");
    assert.equal(plan.cookies.length, 1);
    const [cookie] = plan.cookies;
    assert.equal(cookie!.name, "nightly_claim");
    assert.equal(cookie!.maxAge, 600);
    assert.match(cookie!.value, /^[A-Za-z0-9_-]+$/u);
    assert.deepEqual(decodeClaimContext(cookie!.value), claim);
});

test("redirect responses are no-store 302s on the request origin that set every cookie with the nightly attributes", () => {
    const cookies = [{ name: "nightly_sponsor", value: SESSION, maxAge: 0 }, { name: "nightly_claim", value: "", maxAge: 0 }];
    const response = redirectResponse({ location: "/nightly/sponsor", cookies }, "https://bannerlordcoop.com/nightly/callback?code=x");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://bannerlordcoop.com/nightly/sponsor");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(response.headers.getSetCookie(), [`nightly_sponsor=${SESSION}; ${COOKIE_ATTRIBUTES}`, `nightly_claim=; ${COOKIE_ATTRIBUTES}`]);
    assert.equal(redirectResponse({ location: AUTHORIZE, cookies: [] }, "https://bannerlordcoop.com/nightly/activate").headers.get("location"), AUTHORIZE);
});

test("cookie readers reject tampered values", () => {
    assert.equal(readSponsorSession(SESSION), SESSION);
    for (const bad of [undefined, "", "short", `${SESSION}x`, "s".repeat(42) + "!"]) assert.equal(readSponsorSession(bad), null);
    const claim = { deviceId: DEVICE_ID, username: "u", previousSponsorRevoked: false };
    assert.deepEqual(decodeClaimContext(encodeClaimContext(claim)), claim);
    const forge = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    assert.deepEqual(decodeClaimContext(forge({ deviceId: DEVICE_ID, username: "u", previousSponsorRevoked: "yes" })), claim);
    const forged = [
        forge({ deviceId: "device-1", username: "u" }), forge({ deviceId: DEVICE_ID, username: "" }),
        forge({ deviceId: DEVICE_ID, username: "x".repeat(101) }), forge({ d: DEVICE_ID, u: "u" }), forge([1]),
    ];
    for (const bad of [undefined, "", "!!!", "x".repeat(2000), ...forged]) {
        assert.equal(decodeClaimContext(bad), null, String(bad).slice(0, 40));
    }
});

test("each query flag's reader recognises exactly the path that sets it", () => {
    const query = (path: string) => Object.fromEntries(new URL(path, "https://bannerlordcoop.com").searchParams);
    assert.equal(SESSION_EXPIRED_PATH, "/nightly/sponsor?session=expired");
    assert.equal(SPONSORED_APPROVED_PATH, "/nightly/approved?via=sponsor");
    assert.equal(isSessionExpiredNotice(query(SESSION_EXPIRED_PATH)), true);
    assert.equal(isSponsoredApproval(query(SPONSORED_APPROVED_PATH)), true);
    for (const params of [{}, { session: "valid" }, { session: ["expired", "expired"] }, { via: "sponsor" }]) {
        assert.equal(isSessionExpiredNotice(params), false, JSON.stringify(params));
    }
    for (const params of [{}, { via: "discord" }, { via: ["sponsor"] }, { session: "expired" }]) {
        assert.equal(isSponsoredApproval(params), false, JSON.stringify(params));
    }
});

test("the error query reader reads back what errorPath writes and narrows anything else", () => {
    const query = (path: string) => Object.fromEntries(new URL(path, "https://bannerlordcoop.com").searchParams);
    assert.equal(errorPath("sponsor-code", "seats_full"), "/nightly/error?context=sponsor-code&code=seats_full");
    assert.deepEqual(readErrorQuery(query(errorPath("claim", "expired"))), { context: "claim", code: "expired" });
    assert.deepEqual(readErrorQuery({}), { context: null, code: "" });
    assert.deepEqual(readErrorQuery({ context: "toString", code: "expired" }), { context: null, code: "expired" });
    assert.deepEqual(readErrorQuery({ context: ["claim", "claim"], code: ["expired", "expired"] }), { context: null, code: "" });
});
