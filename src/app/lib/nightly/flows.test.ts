import assert from "node:assert/strict";
import test from "node:test";
import type { NightlyClient, NightlyFailure } from "./client";
import { sameOriginRequest, sameOriginSubmission, servedHost } from "../auth/same-origin";
import {
    claimActionResult,
    createCodeActionResult,
    loadPortalView,
    removeSeatActionResult,
} from "./flows";
import { GENERIC_ERROR_MESSAGE, nightlyErrorMessage, nightlyErrorView, parseErrorContext, ROLE_REQUIRED_MESSAGE } from "./messages";

const SESSION = "s".repeat(43);
const CLAIM = { deviceId: "device-1", username: "friend", previousSponsorRevoked: false };
const PORTAL = { seats: [{ discordUserId: "123456789012345678", createdAt: null }], limit: 10 };
const CLAIM_REQUEST = { sameOrigin: true, claim: CLAIM };
const SPONSOR_REQUEST = { sameOrigin: true, session: SESSION };
const APPROVED = { clearCookie: "nightly_claim", redirectTo: "/nightly/approved?via=sponsor" };
const EXPIRED = { clearCookie: "nightly_sponsor", redirectTo: "/nightly/sponsor?session=expired" };

/** Builds a client stub whose methods fail loudly unless a test overrides them. */
function stubClient(overrides: Partial<NightlyClient>): NightlyClient {
    const unexpected = async (): Promise<never> => { throw new Error("unexpected call"); };
    return {
        startDeviceOAuth: unexpected, startSponsorOAuth: unexpected, completeOAuth: unexpected, claimSponsorship: unexpected,
        sponsorPortal: unexpected, createSponsorCode: unexpected, removeSponsoredAccount: unexpected,
        ...overrides,
    };
}

/** Builds a failed client result. */
function fail(status: number, code: string): NightlyFailure {
    return { ok: false, status, code };
}

test("portal view: no session shows login, success shows seats, 401 clears once, 403 explains lost eligibility", async () => {
    assert.deepEqual(await loadPortalView(stubClient({}), null, false), { kind: "login", expired: false });
    assert.deepEqual(await loadPortalView(stubClient({}), null, true), { kind: "login", expired: true });
    const sessions: string[] = [];
    const seats = stubClient({ sponsorPortal: async (session) => { sessions.push(session); return { ok: true, value: PORTAL }; } });
    assert.deepEqual(await loadPortalView(seats, SESSION, false), { kind: "seats", data: PORTAL });
    assert.deepEqual(sessions, [SESSION]);
    const expired = stubClient({ sponsorPortal: async () => fail(401, "authorization_expired") });
    assert.deepEqual(await loadPortalView(expired, SESSION, false), { kind: "clear-session" });
    assert.deepEqual(await loadPortalView(expired, SESSION, true), { kind: "login", expired: true });
    const ineligible = stubClient({ sponsorPortal: async () => fail(403, "supporter_role_required") });
    assert.deepEqual(await loadPortalView(ineligible, SESSION, false), { kind: "ineligible", message: ROLE_REQUIRED_MESSAGE });
    const down = stubClient({ sponsorPortal: async () => fail(502, "discord_unavailable") });
    assert.deepEqual(await loadPortalView(down, SESSION, false), { kind: "error", message: GENERIC_ERROR_MESSAGE });
});

test("claim sends the cookie's device and the normalized code, and maps every contract error", async () => {
    const calls: string[][] = [];
    const approve = stubClient({ claimSponsorship: async (device, code) => { calls.push([device, code]); return { ok: true, value: null }; } });
    assert.deepEqual(await claimActionResult(approve, CLAIM_REQUEST, "  ab2c-def3-gh45 "), APPROVED);
    assert.deepEqual(calls, [["device-1", "AB2C-DEF3-GH45"]]);

    const expected: Array<[number, string, string]> = [
        [400, "expired", "That installer authorization has expired."],
        [403, "invalid_sponsor_code", "That sponsor code is not valid."],
        [403, "supporter_role_required", "That sponsor no longer has a qualifying Staff, Tester, Patreon, Boosty, or Afdian role."],
        [409, "already_sponsored", "This Discord account already has sponsored access."],
        [409, "seats_full", "That eligible member has already used all 10 sponsored-account seats."],
        [502, "discord_unavailable", GENERIC_ERROR_MESSAGE],
    ];
    for (const [status, code, message] of expected) {
        const client = stubClient({ claimSponsorship: async () => fail(status, code) });
        assert.deepEqual(await claimActionResult(client, CLAIM_REQUEST, "AAAA-BBBB-CCCC"), { state: { error: message } }, code);
    }
});

test("claim rejects a missing claim cookie or an unusable code before calling the Edge Function", async () => {
    const client = stubClient({});
    const missing = await claimActionResult(client, { sameOrigin: true, claim: null }, "AAAA-BBBB-CCCC");
    assert.deepEqual(missing, { state: { error: "That installer authorization has expired." } });
    for (const code of [null, "", "   ", "x".repeat(129)]) {
        assert.deepEqual(await claimActionResult(client, CLAIM_REQUEST, code), { state: { error: "That sponsor code is not valid." } });
    }
});

test("create code returns the code once, expires on 401 or a missing session and maps other errors", async () => {
    assert.deepEqual(await createCodeActionResult(stubClient({}), { sameOrigin: true, session: null }), EXPIRED);
    const created = stubClient({ createSponsorCode: async () => ({ ok: true, value: "AB2C-DEF3-GH45" }) });
    assert.deepEqual(await createCodeActionResult(created, SPONSOR_REQUEST), { state: { code: "AB2C-DEF3-GH45", error: null } });
    const expired = stubClient({ createSponsorCode: async () => fail(401, "authorization_expired") });
    assert.deepEqual(await createCodeActionResult(expired, SPONSOR_REQUEST), EXPIRED);
    const down = stubClient({ createSponsorCode: async () => fail(500, "internal_error") });
    assert.deepEqual(await createCodeActionResult(down, SPONSOR_REQUEST), { state: { code: null, error: GENERIC_ERROR_MESSAGE } });
});

test("remove seat validates the Discord id, reloads on success, expires on 401 or a missing session and maps 400", async () => {
    const calls: string[][] = [];
    const removed = stubClient({ removeSponsoredAccount: async (session, id) => { calls.push([session, id]); return { ok: true, value: null }; } });
    assert.deepEqual(await removeSeatActionResult(removed, SPONSOR_REQUEST, "123456789012345678"), { clearCookie: null, redirectTo: "/nightly/sponsor" });
    assert.deepEqual(calls, [[SESSION, "123456789012345678"]]);
    assert.deepEqual(await removeSeatActionResult(stubClient({}), { sameOrigin: true, session: null }, "123456789012345678"), EXPIRED);
    const invalid = { state: { error: nightlyErrorMessage("sponsor-remove", "invalid_request") } };
    for (const bad of [null, "", "abc", "1234", "123456789012345678<"]) {
        assert.deepEqual(await removeSeatActionResult(stubClient({}), SPONSOR_REQUEST, bad), invalid);
    }
    const expired = stubClient({ removeSponsoredAccount: async () => fail(401, "authorization_expired") });
    assert.deepEqual(await removeSeatActionResult(expired, SPONSOR_REQUEST, "123456789012345678"), EXPIRED);
    const rejected = stubClient({ removeSponsoredAccount: async () => fail(400, "http_400") });
    assert.deepEqual(await removeSeatActionResult(rejected, SPONSOR_REQUEST, "123456789012345678"), invalid);
});

test("error messages use the gateway's wording per step and never echo the code", () => {
    assert.equal(nightlyErrorMessage("activate", "invalid_code"), "That installer code is invalid.");
    assert.equal(nightlyErrorMessage("activate", "expired"), "That installer code has expired.");
    assert.equal(nightlyErrorMessage("callback", "invalid_request"), "Discord sign-in could not be verified.");
    assert.equal(nightlyErrorMessage("callback", "expired"), "That installer authorization has expired.");
    for (const code of ["discord_membership_required", "migration_in_progress", "unavailable", "not_configured", "constructor", "__proto__", "<b>x</b>"]) {
        assert.equal(nightlyErrorMessage("callback", code), GENERIC_ERROR_MESSAGE, code);
    }
    assert.deepEqual(nightlyErrorView("callback", "supporter_role_required"), { message: ROLE_REQUIRED_MESSAGE, help: "sponsor-code" });
    assert.deepEqual(nightlyErrorView("claim", "supporter_role_required").help, null);
    assert.equal(parseErrorContext("claim"), "claim");
    assert.equal(parseErrorContext("toString"), null);
    assert.equal(parseErrorContext(undefined), null);
});

test("same-origin submissions require matching Fetch Metadata or Origin", () => {
    const check = (values: Record<string, string>) => {
        const headers = new Headers(values);
        return sameOriginSubmission(headers, servedHost(headers));
    };
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

test("claim action refuses a cross-origin post without calling the Edge Function", async () => {
    const result = await claimActionResult(stubClient({}), { sameOrigin: false, claim: CLAIM }, "AAAA-BBBB-CCCC");
    assert.deepEqual(result, { state: { error: GENERIC_ERROR_MESSAGE } });
});

test("sponsor actions refuse cross-origin posts without calling the Edge Function", async () => {
    const request = { sameOrigin: false, session: SESSION };
    assert.deepEqual(await createCodeActionResult(stubClient({}), request), { state: { code: null, error: GENERIC_ERROR_MESSAGE } });
    assert.deepEqual(await removeSeatActionResult(stubClient({}), request, "123456789012345678"), { state: { error: GENERIC_ERROR_MESSAGE } });
});
