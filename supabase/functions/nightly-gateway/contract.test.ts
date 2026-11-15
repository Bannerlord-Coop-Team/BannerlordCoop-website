import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { createNightlyClient } from "../../../src/app/lib/nightly/client.ts";
import {
    body,
    createGatewayDatabase,
    discordScript,
    FRIEND,
    gatewayHandler,
    installerRequest,
    NOW,
    PATREON_ROLE,
    seedGrant,
    SPONSOR,
    WEBSITE_KEY,
} from "./test-harness.ts";

// Contract test: the website's real Edge Function client, routed in-process to the real Edge handler
// over PGlite with the gateway migrations, so both sides of the website contract are checked together.

const FUNCTION_URL = "https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/nightly-gateway";
const SPONSOR_CODE = "SPON-SORC-ODE2";

let database: PGlite;

before(async () => { database = await createGatewayDatabase(); });
after(async () => { await database?.close(); });

/** Returns the `state` the gateway put on a Discord authorize URL. */
function stateOf(authorizeUrl: string): string {
    const state = new URL(authorizeUrl).searchParams.get("state");
    assert.ok(state !== null);
    return state;
}

/** Unwraps a successful client result, failing the test with the decoded failure otherwise. */
function value<T>(result: { ok: true; value: T } | { ok: false; status: number; code: string }): T {
    if (!result.ok) assert.fail(`expected success, got ${result.status} ${result.code}`);
    return result.value;
}

test("the website client drives device sign-in, a sponsor claim and the sponsor portal against the Edge handler", async () => {
    await seedGrant(database, SPONSOR, SPONSOR_CODE);
    const script = discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } });
    const { handler } = gatewayHandler(database, script);
    const client = createNightlyClient(
        { functionUrl: FUNCTION_URL, websiteKey: WEBSITE_KEY },
        (url, init) => handler(new Request(url, init)),
    );
    const created = await body(await handler(installerRequest("/v1/device/sessions", "client=installer")));

    const deviceAuthorize = value(await client.startDeviceOAuth(created.user_code as string));
    assert.equal(new URL(deviceAuthorize).origin, "https://discord.com");
    const portalAuthorize = value(await client.startSponsorOAuth());
    assert.notEqual(stateOf(portalAuthorize), stateOf(deviceAuthorize));

    const needsSponsor = value(await client.completeOAuth("friend-code", stateOf(deviceAuthorize)));
    assert.equal(needsSponsor.outcome, "needs-sponsor");
    if (needsSponsor.outcome !== "needs-sponsor") return;
    assert.deepEqual(needsSponsor, {
        outcome: "needs-sponsor",
        claim: { deviceId: needsSponsor.claim.deviceId, username: "Sponsored Friend", previousSponsorRevoked: false },
    });

    assert.deepEqual(await client.claimSponsorship(needsSponsor.claim.deviceId, "NOPE-NOPE-NOPE"), {
        ok: false, status: 403, code: "invalid_sponsor_code",
    });
    assert.deepEqual(await client.claimSponsorship(needsSponsor.claim.deviceId, SPONSOR_CODE), { ok: true, value: null });

    script.user = { id: SPONSOR, username: "Sponsor" };
    script.member = { roles: [PATREON_ROLE] };
    const portal = value(await client.completeOAuth("sponsor-code", stateOf(portalAuthorize)));
    assert.equal(portal.outcome, "portal");
    if (portal.outcome !== "portal") return;
    assert.equal(portal.expires_in, 86_400);

    assert.deepEqual(value(await client.sponsorPortal(portal.session)), {
        seats: [{ discordUserId: FRIEND, createdAt: new Date(NOW * 1000) }],
    });
    const rotated = value(await client.createSponsorCode(portal.session));
    assert.match(rotated, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.notEqual(rotated, SPONSOR_CODE);

    assert.deepEqual(await client.removeSponsoredAccount(portal.session, FRIEND), { ok: true, value: null });
    assert.deepEqual(value(await client.sponsorPortal(portal.session)), { seats: [] });
    assert.deepEqual(await client.sponsorPortal("x".repeat(43)), { ok: false, status: 401, code: "authorization_expired" });
});

test("the website client decodes a wrong website key as the gateway's 401", async () => {
    const { handler } = gatewayHandler(database, discordScript());
    const client = createNightlyClient(
        { functionUrl: FUNCTION_URL, websiteKey: "x".repeat(48) },
        (url, init) => handler(new Request(url, init)),
    );
    assert.deepEqual(await client.startSponsorOAuth(), { ok: false, status: 401, code: "unauthorized" });
});
