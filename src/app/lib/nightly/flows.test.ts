import assert from "node:assert/strict";
import test from "node:test";
import type { NightlyClient, NightlyFailure } from "./client";
import { sameOriginRequest, sameOriginSubmission, servedHost } from "../auth/same-origin";
import {
    claimActionResult,
    createCodeActionResult,
    loadPortalView,
    removeSeatActionResult,
    submitClaim,
    submitCreateCode,
    submitRemoveSeat,
} from "./flows";
import { GENERIC_ERROR_MESSAGE, nightlyErrorMessage, nightlyErrorView, parseErrorContext, ROLE_REQUIRED_MESSAGE } from "./messages";

const SESSION = "s".repeat(43);
const CLAIM = { deviceId: "device-1", username: "friend", previousSponsorRevoked: false };
const PORTAL = { seats: [{ discordUserId: "123456789012345678", createdAt: null }], limit: 10 };

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
    assert.deepEqual(await submitClaim(approve, CLAIM, "  ab2c-def3-gh45 "), { kind: "approved" });
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
        assert.deepEqual(await submitClaim(client, CLAIM, "AAAA-BBBB-CCCC"), { kind: "error", message }, code);
    }
});

test("claim rejects a missing claim cookie or an unusable code before calling the Edge Function", async () => {
    const client = stubClient({});
    assert.deepEqual(await submitClaim(client, null, "AAAA-BBBB-CCCC"), { kind: "error", message: "That installer authorization has expired." });
    for (const code of [null, "", "   ", "x".repeat(129)]) {
        assert.deepEqual(await submitClaim(client, CLAIM, code), { kind: "error", message: "That sponsor code is not valid." });
    }
});

test("create code returns the code once, expires on 401 and maps other errors", async () => {
    assert.deepEqual(await submitCreateCode(stubClient({}), null), { kind: "session-expired" });
    const created = stubClient({ createSponsorCode: async () => ({ ok: true, value: "AB2C-DEF3-GH45" }) });
    assert.deepEqual(await submitCreateCode(created, SESSION), { kind: "code", code: "AB2C-DEF3-GH45" });
    assert.deepEqual(await submitCreateCode(stubClient({ createSponsorCode: async () => fail(401, "authorization_expired") }), SESSION), { kind: "session-expired" });
    assert.deepEqual(await submitCreateCode(stubClient({ createSponsorCode: async () => fail(500, "internal_error") }), SESSION), { kind: "error", message: GENERIC_ERROR_MESSAGE });
});

test("remove seat validates the Discord id, expires on 401 and maps 400", async () => {
    const calls: string[][] = [];
    const removed = stubClient({ removeSponsoredAccount: async (session, id) => { calls.push([session, id]); return { ok: true, value: null }; } });
    assert.deepEqual(await submitRemoveSeat(removed, SESSION, "123456789012345678"), { kind: "removed" });
    assert.deepEqual(calls, [[SESSION, "123456789012345678"]]);
    assert.deepEqual(await submitRemoveSeat(stubClient({}), null, "123456789012345678"), { kind: "session-expired" });
    const invalid = nightlyErrorMessage("sponsor-remove", "invalid_request");
    for (const bad of [null, "", "abc", "1234", "123456789012345678<"]) {
        assert.deepEqual(await submitRemoveSeat(stubClient({}), SESSION, bad), { kind: "error", message: invalid });
    }
    assert.deepEqual(await submitRemoveSeat(stubClient({ removeSponsoredAccount: async () => fail(401, "authorization_expired") }), SESSION, "123456789012345678"), { kind: "session-expired" });
    assert.deepEqual(await submitRemoveSeat(stubClient({ removeSponsoredAccount: async () => fail(400, "http_400") }), SESSION, "123456789012345678"), { kind: "error", message: invalid });
});

test("error messages use the gateway's wording per step and never echo the code", () => {
    assert.equal(nightlyErrorMessage("activate", "invalid_code"), "That installer code is invalid.");
    assert.equal(nightlyErrorMessage("activate", "expired"), "That installer code has expired.");
    assert.equal(nightlyErrorMessage("callback", "invalid_request"), "Discord sign-in could not be verified.");
    assert.equal(nightlyErrorMessage("callback", "expired"), "That installer authorization has expired.");
    assert.equal(nightlyErrorMessage("callback", "migration_in_progress"), "Nightly access is briefly paused while account data is moved. Try again in a few minutes.");
    for (const code of ["discord_membership_required", "unavailable", "not_configured", "constructor", "__proto__", "<b>x</b>"]) {
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

test("claim action clears the claim cookie and redirects after a successful claim, and re-renders errors", async () => {
    const approve = stubClient({ claimSponsorship: async () => ({ ok: true, value: null }) });
    assert.deepEqual(await claimActionResult(approve, { sameOrigin: true, claim: CLAIM }, "AAAA-BBBB-CCCC"), {
        clearCookie: "nightly_claim", redirectTo: "/nightly/approved?via=sponsor",
    });
    const full = stubClient({ claimSponsorship: async () => fail(409, "seats_full") });
    assert.deepEqual(await claimActionResult(full, { sameOrigin: true, claim: CLAIM }, "AAAA-BBBB-CCCC"), {
        state: { error: nightlyErrorMessage("claim", "seats_full") },
    });
});

test("sponsor actions refuse cross-origin posts without calling the Edge Function", async () => {
    const request = { sameOrigin: false, session: SESSION };
    assert.deepEqual(await createCodeActionResult(stubClient({}), request), { state: { code: null, error: GENERIC_ERROR_MESSAGE } });
    assert.deepEqual(await removeSeatActionResult(stubClient({}), request, "123456789012345678"), { state: { error: GENERIC_ERROR_MESSAGE } });
});

test("an expired sponsor session clears the sponsor cookie and returns to the expired login prompt", async () => {
    const expired = { clearCookie: "nightly_sponsor", redirectTo: "/nightly/sponsor?session=expired" };
    const rejected = stubClient({ createSponsorCode: async () => fail(401, "authorization_expired"), removeSponsoredAccount: async () => fail(401, "authorization_expired") });
    assert.deepEqual(await createCodeActionResult(rejected, { sameOrigin: true, session: SESSION }), expired);
    assert.deepEqual(await removeSeatActionResult(rejected, { sameOrigin: true, session: SESSION }, "123456789012345678"), expired);
    assert.deepEqual(await createCodeActionResult(stubClient({}), { sameOrigin: true, session: null }), expired);
});

test("sponsor actions return the new code, reload after a removal and re-render errors", async () => {
    const client = stubClient({
        createSponsorCode: async () => ({ ok: true, value: "AB2C-DEF3-GH45" }),
        removeSponsoredAccount: async () => ({ ok: true, value: null }),
    });
    const request = { sameOrigin: true, session: SESSION };
    assert.deepEqual(await createCodeActionResult(client, request), { state: { code: "AB2C-DEF3-GH45", error: null } });
    assert.deepEqual(await removeSeatActionResult(client, request, "123456789012345678"), { clearCookie: null, redirectTo: "/nightly/sponsor" });
    const invalid = nightlyErrorMessage("sponsor-remove", "invalid_request");
    assert.deepEqual(await removeSeatActionResult(client, request, "bad"), { state: { error: invalid } });
});
