import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import {
    CANONICAL_GATEWAY_ORIGIN,
    LEGACY_GATEWAY_ORIGIN,
    PUBLIC_MANUAL_SERVER_ORIGIN,
} from "../../../nightly-gateway/src/origins.ts";
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

// Contract tests: the website's real Edge Function client and the real Worker's installer forwarding, each routed
// in-process to the real Edge handler over PGlite with the gateway migrations, so both sides of each contract are
// checked together.

// Discards the client's failure logs; these tests assert the decoded results instead.
const noLog = (): void => {};

const FUNCTION_URL = "https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/nightly-gateway";
/**
 * The Worker's entry module. It is imported at run time from a non-literal specifier so the website's `tsc` never
 * compiles it: it is typed against the Worker's own globals (Env, ExportedHandler), which only its tsconfig declares.
 */
const WORKER_ENTRY = "../../../nightly-gateway/src/index.ts";
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

/** The slice of the Worker entry module this test drives: `createGateway` over an injected fetch and log. */
type WorkerEntry = {
    createGateway(dependencies: {
        fetch: (url: string, init: RequestInit) => Promise<Response>;
        log: (event: Record<string, unknown>) => void;
    }): { fetch(request: Request, env: unknown): Promise<Response> };
};

/** The Worker's env for its forwarded device routes: no database binding, since those routes never open one. */
function forwardingEnv(): Record<string, string> {
    return { LEGACY_R2_ORIGIN: PUBLIC_MANUAL_SERVER_ORIGIN, NIGHTLY_FUNCTION_URL: FUNCTION_URL };
}

/** An installer's url-encoded POST to the Worker on one of its public hosts. */
function installerPost(origin: string, path: string, form: string): Request {
    return new Request(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
    });
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
        noLog,
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
    assert.equal(portal.expiresIn, 86_400);

    assert.deepEqual(value(await client.sponsorPortal(portal.session)), {
        seats: [{ discordUserId: FRIEND, createdAt: new Date(NOW * 1000) }],
    });
    const newCode = value(await client.createSponsorCode(portal.session));
    assert.match(newCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.notEqual(newCode, SPONSOR_CODE);

    assert.deepEqual(await client.removeSponsoredAccount(portal.session, FRIEND), { ok: true, value: null });
    assert.deepEqual(value(await client.sponsorPortal(portal.session)), { seats: [] });
    assert.deepEqual(await client.sponsorPortal("x".repeat(43)), { ok: false, status: 401, code: "authorization_expired" });
});

test("the website client decodes a wrong website key as the gateway's 401", async () => {
    const { handler } = gatewayHandler(database, discordScript());
    const client = createNightlyClient(
        { functionUrl: FUNCTION_URL, websiteKey: "x".repeat(48) },
        (url, init) => handler(new Request(url, init)),
        noLog,
    );
    assert.deepEqual(await client.startSponsorOAuth(), { ok: false, status: 401, code: "unauthorized" });
});

test("the Worker forwards an installer's device calls to the Edge handler and back, on both public hosts", async () => {
    const { createGateway } = await import(WORKER_ENTRY) as WorkerEntry;
    const { handler } = gatewayHandler(database, discordScript());
    const workerLogs: Record<string, unknown>[] = [];
    const worker = createGateway({ fetch: (url, init) => handler(new Request(url, init)), log: (event) => workerLogs.push(event) });
    for (const origin of [CANONICAL_GATEWAY_ORIGIN, LEGACY_GATEWAY_ORIGIN]) {
        const created = await worker.fetch(installerPost(origin, "/v1/device/sessions", "client=installer"), forwardingEnv());
        assert.equal(created.status, 201, origin);
        const session = await body(created);
        assert.equal(session.verification_uri, `${origin}/activate?code=${encodeURIComponent(session.user_code as string)}`, origin);
        assert.equal(session.expires_in, 600, origin);

        const polled = await worker.fetch(
            installerPost(origin, "/v1/device/token", `device_code=${session.device_code as string}`),
            forwardingEnv(),
        );
        assert.deepEqual([polled.status, await body(polled)], [428, { error: "authorization_pending" }], origin);
    }
    assert.deepEqual(workerLogs, [], "the Worker logged no forwarding failure");
});
