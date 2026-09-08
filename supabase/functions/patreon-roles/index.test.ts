import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createPatreonRoleHandler, createPatreonRoleRpc, parsePatreonMembership } from "../_shared/patreon-roles.ts";

const campaignId = "12345";
const tierId = "28995946";
const memberId = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";
const webhookSecret = "webhook-secret-for-fixtures";
const syncSecret = "scheduler-secret-for-fixtures";
const creatorAccessToken = "creator-token-for-fixtures";

function membership() {
    return {
        data: {
            type: "member", id: memberId,
            attributes: { email: "Patron@Example.com", is_free_trial: false, is_gifted: false, last_charge_status: "Paid" },
            relationships: {
                campaign: { data: { type: "campaign", id: campaignId } },
                user: { data: { type: "user", id: "123" } },
                currently_entitled_tiers: { data: [{ type: "tier", id: tierId }] },
            },
        },
        included: [{ type: "user", id: "123", attributes: { email: "patron@example.com", is_email_verified: true } }],
    };
}

function webhook(body = JSON.stringify(membership()), event = "members:pledge:create", secret = webhookSecret) {
    return new Request("https://example.test/functions/v1/patreon-roles", {
        method: "POST", body,
        headers: { "x-patreon-event": event, "x-patreon-signature": createHmac("md5", secret).update(body).digest("hex") },
    });
}

function sync(key = syncSecret) {
    return new Request("https://example.test/functions/v1/patreon-roles", { method: "POST", headers: { "x-patreon-sync-key": key } });
}

function setup(fetchImplementation: typeof fetch = async () => Response.json(membership())) {
    const calls: { operation: string; input: Record<string, unknown> }[] = [];
    const options = {
        campaignId, tierId, creatorAccessToken, webhookSecret, syncSecret, fetchImplementation,
        rpc: async (operation: string, input: Record<string, unknown>): Promise<unknown> => {
            calls.push({ operation, input });
            if (operation === "acquire") return { token, jobs: [{ memberId, generation: 1 }], cursor: "", scanDue: false };
            return {};
        },
    };
    return { calls, options, handler: createPatreonRoleHandler(options) };
}

test("signed webhooks queue only a member ID; cancellation payload never revokes directly", async () => {
    const { handler, calls } = setup(async () => { throw new Error("webhook must not call Patreon"); });
    for (const event of ["members:create", "members:update", "members:delete", "members:pledge:create", "members:pledge:update", "members:pledge:delete"]) {
        assert.equal((await handler(webhook(undefined, event))).status, 202);
    }
    assert.deepEqual(calls, Array(6).fill({ operation: "queue", input: { memberId } }));
});

test("rejects missing/tampered signatures, wrong campaigns, unsupported events and oversized bodies", async () => {
    const { handler, calls } = setup();
    assert.equal((await handler(webhook(undefined, undefined, "wrong-secret"))).status, 401);
    const request = webhook();
    request.headers.delete("x-patreon-signature");
    assert.equal((await handler(request)).status, 401);
    const data = membership();
    data.data.relationships.campaign.data.id = "999";
    assert.equal((await handler(webhook(JSON.stringify(data)))).status, 400);
    assert.equal((await handler(webhook(undefined, "posts:publish"))).status, 400);
    assert.equal((await handler(webhook("x".repeat(1024 * 1024 + 1)))).status, 400);
    assert.deepEqual(calls, []);
});

test("queue failures return retryable errors without leaking upstream data", async () => {
    const { options } = setup();
    options.rpc = async () => { throw new Error("secret and patron@example.com"); };
    const response = await createPatreonRoleHandler(options)(webhook());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "queue_unavailable" });
});

test("matches the configured tier and returns the stable linked identity", () => {
    const data = membership();
    assert.deepEqual(parsePatreonMembership(data, campaignId, tierId, memberId), {
        memberId, userId: "123", eligible: true,
    });
    data.data.relationships.currently_entitled_tiers.data = [{ type: "tier", id: "456" }];
    assert.equal(parsePatreonMembership(data, campaignId, tierId, memberId).eligible, false);
});

test("paid-through cancellation retains role; explicit loss of tier revokes it", () => {
    const data = { ...membership(), patron_status: "former_patron" };
    assert.equal(parsePatreonMembership(data, campaignId, tierId, memberId).eligible, true);
    data.data.relationships.currently_entitled_tiers.data = [];
    assert.equal(parsePatreonMembership(data, campaignId, tierId, memberId).eligible, false);
});

test("trials and failed charges do not grant the paid benefit; gifts with current tier do", () => {
    const data = membership();
    data.data.attributes.is_free_trial = true;
    assert.equal(parsePatreonMembership(data, campaignId, tierId, memberId).eligible, false);
    data.data.attributes.is_free_trial = false;
    data.data.attributes.last_charge_status = "Declined";
    assert.equal(parsePatreonMembership(data, campaignId, tierId, memberId).eligible, false);
    data.data.attributes.is_gifted = true;
    assert.equal(parsePatreonMembership(data, campaignId, tierId, memberId).eligible, true);
});

test("email visibility does not affect verified OAuth identity membership", () => {
    const data = membership();
    data.data.attributes.email = "";
    data.included[0].attributes.is_email_verified = false;
    data.included[0].attributes.email = "other@example.com";
    assert.deepEqual(parsePatreonMembership(data, campaignId, tierId, memberId), {
        memberId, userId: "123", eligible: true,
    });
    assert.throws(() => parsePatreonMembership(data, "999", tierId, memberId));
    assert.throws(() => parsePatreonMembership(data, campaignId, tierId, token));
    const incomplete = structuredClone(data) as Record<string, unknown>;
    (incomplete.data as Record<string, unknown>).relationships = {};
    assert.throws(() => parsePatreonMembership(incomplete, campaignId, tierId, memberId));
});

test("scheduler secret is distinct from webhook/creator credentials", async () => {
    const { handler, calls } = setup();
    for (const key of [webhookSecret, creatorAccessToken, "wrong"]) assert.equal((await handler(sync(key))).status, 401);
    assert.deepEqual(calls, []);
    const { options } = setup();
    assert.throws(() => createPatreonRoleHandler({ ...options, syncSecret: webhookSecret }));
    assert.throws(() => createPatreonRoleHandler({ ...options, syncSecret: creatorAccessToken }));
});

test("worker fetches authoritative fixed-origin membership and completes under its generation/lease", async () => {
    const { handler, calls } = setup(async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, "https://www.patreon.com");
        assert.equal(url.pathname, `/api/oauth2/v2/members/${memberId}`);
        assert.equal(url.searchParams.get("fields[user]"), null);
        assert.equal(url.searchParams.get("fields[member]"), "is_free_trial,is_gifted,last_charge_status");
        assert.equal(init?.redirect, "error");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${creatorAccessToken}`);
        return Response.json(membership());
    });
    assert.equal((await handler(sync())).status, 200);
    assert.deepEqual(calls.map((call) => call.operation), ["acquire", "complete", "release"]);
    assert.deepEqual(calls[1].input, { token, generation: 1, memberId, userId: "123", eligible: true });
});

test("404, throttling, token expiry, oversized and malformed responses never become revocations", async () => {
    for (const response of [
        new Response(null, { status: 404 }), new Response(null, { status: 401 }), new Response(null, { status: 429 }),
        Response.json({}), new Response("x".repeat(1024 * 1024 + 1)),
    ]) {
        const { handler, calls } = setup(async () => response);
        assert.equal((await handler(sync())).status, 503);
        assert.deepEqual(calls.map((call) => call.operation), ["acquire", "failed", "release"]);
    }
});

test("a current worker lease prevents duplicate work", async () => {
    const { options } = setup(async () => { throw new Error("must not fetch"); });
    options.rpc = async () => null;
    const response = await createPatreonRoleHandler(options)(sync());
    assert.deepEqual(await response.json(), { code: "already_running" });
});

test("discovery is paginated through a validated cursor and never follows arbitrary links", async () => {
    for (const next of [
        `https://www.patreon.com/api/oauth2/v2/campaigns/${campaignId}/members?page%5Bcursor%5D=page-two`,
        "https://attacker.example/?page%5Bcursor%5D=stolen",
    ]) {
        const { options, calls } = setup(async () => Response.json({ data: [membership().data], links: { next } }));
        const rpc = options.rpc;
        options.rpc = async (operation, input) => operation === "acquire"
            ? { token, jobs: [], cursor: "", scanDue: true, scanGeneration: 1 } : rpc(operation, input);
        const response = await createPatreonRoleHandler(options)(sync());
        if (next.includes("attacker")) {
            assert.equal(response.status, 503);
            assert.deepEqual(calls.map((call) => call.operation), ["release"]);
        } else {
            assert.equal(response.status, 200);
            assert.deepEqual(calls[0], { operation: "discovered", input: { token, memberIds: [memberId], members: [{ memberId, userId: "123" }], cursor: "page-two", scanGeneration: 1 } });
        }
    }
});

test("RPC adapter only calls the fixed service-role-only function", async () => {
    const rpc = createPatreonRoleRpc({
        supabaseUrl: "https://project.supabase.co", serviceKey: "fixture-service-role-key", campaignId, tierId,
        fetchImplementation: async (url, init) => {
            assert.equal(String(url), "https://project.supabase.co/rest/v1/rpc/patreon_role_sync");
            assert.equal(init?.redirect, "error");
            assert.deepEqual(JSON.parse(String(init?.body)), { p_campaign: campaignId, p_tier: tierId, p_operation: "queue", p_input: { memberId } });
            return Response.json({ queued: true });
        },
    });
    assert.deepEqual(await rpc("queue", { memberId }), { queued: true });
});

test("discovery consumes V2 metadata cursors and sends the saved cursor on the next request", async () => {
    for (const [next, links] of [
        ["page-two", undefined], [null, undefined], ["page-two", {}],
        ["page-two", { next: `https://www.patreon.com/api/oauth2/v2/campaigns/${campaignId}/members?page%5Bcursor%5D=page-two` }],
    ] as const) {
        const { options, calls } = setup(async (input) => {
            const url = new URL(String(input));
            assert.equal(url.pathname, `/api/oauth2/v2/campaigns/${campaignId}/members`);
            assert.equal(url.searchParams.get("include"), "campaign,user");
            assert.equal(url.searchParams.get("page[cursor]"), "page-one");
            return Response.json({ data: [membership().data], meta: { pagination: { cursors: { next } } }, links });
        });
        const rpc = options.rpc;
        options.rpc = async (operation, input) => operation === "acquire"
            ? { token, jobs: [], cursor: "page-one", scanDue: true, scanGeneration: 1 } : rpc(operation, input);
        assert.equal((await createPatreonRoleHandler(options)(sync())).status, 200);
        assert.deepEqual(calls[0], { operation: "discovered", input: { token, memberIds: [memberId], members: [{ memberId, userId: "123" }], cursor: next ?? "", scanGeneration: 1 } });
    }
});

test("discovery rejects duplicate members or missing stable identities before committing a page", async () => {
    const missingIdentity = structuredClone(membership().data);
    Reflect.deleteProperty(missingIdentity.relationships, "user");
    for (const data of [[membership().data, membership().data], [missingIdentity]]) {
        const { options, calls } = setup(async () => Response.json({ data, meta: { pagination: { cursors: { next: null } } } }));
        const rpc = options.rpc;
        options.rpc = async (operation, input) => operation === "acquire"
            ? { token, jobs: [], cursor: "", scanDue: true, scanGeneration: 1 } : rpc(operation, input);
        assert.equal((await createPatreonRoleHandler(options)(sync())).status, 503);
        assert.deepEqual(calls.map(call => call.operation), ["release"]);
    }
});

test("invalid or inconsistent pagination never advances discovery", async () => {
    for (const pagination of [
        {}, { meta: {} },
        ...[7, {}, "x".repeat(1025), "page-one", "bad\ncursor"].map((next) => ({ meta: { pagination: { cursors: { next } } } })),
        { meta: { pagination: { cursors: { next: "page-two" } } }, links: { next: null } },
        { meta: { pagination: { cursors: { next: null } } }, links: { next: `https://www.patreon.com/api/oauth2/v2/campaigns/${campaignId}/members?page%5Bcursor%5D=page-two` } },
    ]) {
        const { options, calls } = setup(async () => Response.json({ data: [membership().data], ...pagination }));
        const rpc = options.rpc;
        options.rpc = async (operation, input) => operation === "acquire"
            ? { token, jobs: [], cursor: "page-one", scanDue: true, scanGeneration: 1 } : rpc(operation, input);
        assert.equal((await createPatreonRoleHandler(options)(sync())).status, 503);
        assert.deepEqual(calls.map((call) => call.operation), ["release"]);
    }
});
