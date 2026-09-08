import assert from "node:assert/strict";
import test from "node:test";
import { currentDiscord, parsePolicy, POLICY_VERSION, parseSnapshot, validUntil, type Policy } from "./membership.ts";
import { verifyPatreonMembership, PATREON_IDENTITY_URL } from "./patreon-membership.ts";
import { createControlPlaneMembershipHandler } from "./control-plane-membership.ts";
import { composeOnboarding, identityStep, parseAccountStatus } from "../../../src/app/lib/hosting/membership-onboarding.ts";
import { onboardingSummary } from "../../../tests/onboarding-fixtures.ts";
const accountId = "aaaaaaaa-1111-4111-8111-111111111111";
const policy: Policy = { campaignId: "10", qualifyingTierIds: ["20"], currency: "USD", minimumCents: 2000, policyVersion: POLICY_VERSION };
const now = "2026-09-07T12:00:00.000Z";
function identity() {
    return { data: { type: "user", id: "1", relationships: { memberships: { data: [{ type: "member", id: "2" }] } } }, included: [
        { type: "member", id: "2", attributes: { patron_status: "active_patron", last_charge_status: "Paid", last_charge_date: "2026-09-01T12:00:00Z", currently_entitled_amount_cents: 2000, is_free_trial: false, is_gifted: false }, relationships: { user: { data: { type: "user", id: "1" } }, campaign: { data: { type: "campaign", id: "10" } }, currently_entitled_tiers: { data: [{ type: "tier", id: "20" }] } } },
        { type: "campaign", id: "10", attributes: { currency: "USD" } }, { type: "tier", id: "20", attributes: { amount_cents: 2000 }, relationships: { campaign: { data: { type: "campaign", id: "10" } } } },
    ] };
}
test("policy is bounded, closed and disabled without reviewed IDs", () => {
    assert.equal(parsePolicy(undefined), null); assert.deepEqual(parsePolicy(JSON.stringify(policy)), policy);
    for (const p of [{ ...policy, minimumCents: 100 }, { ...policy, qualifyingTierIds: ["20", "20"] }, { ...policy, campaignId: "marketing-name" }, { ...policy, secret: "no" }]) assert.throws(() => parsePolicy(JSON.stringify(p)));
    const url = new URL(PATREON_IDENTITY_URL); assert.equal(url.origin, "https://www.patreon.com"); assert.match(url.searchParams.get("include")!, /currently_entitled_tiers/u); assert.doesNotMatch(url.search, /next_charge_date/u);
});
test("current entitled upgrade qualifies intentionally, not proof of captured $20 funds; no inferred paid-through", async () => {
    const body = identity();
    // A previous lower payment followed by an upgrade can produce this exact provider
    // state. No last-charge amount is claimed or manufactured by the adapter.
    const result = await verifyPatreonMembership(body, policy, now);
    assert.equal(result.evidence.verification, "qualifying"); assert.equal(result.evidence.paidThroughAt, null);
    assert.equal(validUntil(result.evidence), "2026-09-08T12:00:00.000Z"); assert.match(result.evidence.evidenceSha256!, /^[a-f0-9]{64}$/u);
    assert.equal((await verifyPatreonMembership(body, null, now)).evidence.verification, "unverified");
});
test("wrong campaign/tier, pending, declined, former, missing, future and incomplete provider data fail closed", async () => {
    const cases: [string, (body: ReturnType<typeof identity>) => void, string][] = [
        ["wrong campaign", b => { b.included[0].relationships!.campaign!.data.id = "11"; }, "nonqualifying"],
        ["wrong tier", b => { b.included[0].relationships!.currently_entitled_tiers!.data[0].id = "21"; b.included[2].id = "21"; }, "nonqualifying"],
        ["declined", b => { b.included[0].attributes.last_charge_status = "Declined"; }, "nonqualifying"],
        ["pending", b => { b.included[0].attributes.last_charge_status = "Pending"; }, "review_required"],
        ["former without paid-through", b => { b.included[0].attributes.patron_status = "former_patron"; }, "review_required"],
        ["future charge", b => { b.included[0].attributes.last_charge_date = "2099-01-01T00:00:00Z"; }, "review_required"],
        ["incomplete includes", b => { b.included.pop(); }, "review_required"],
        ["wrong member identity", b => { b.included[0].relationships!.user!.data.id = "3"; }, "review_required"],
        ["wrong currency", b => { b.included[1].attributes.currency = "EUR"; }, "review_required"],
        ["free trial", b => { b.included[0].attributes.is_free_trial = true; }, "review_required"],
    ];
    for (const [name, mutate, expected] of cases) { const body = identity(); mutate(body); assert.equal((await verifyPatreonMembership(body, policy, now)).evidence.verification, expected, name); }
    const paged = { ...identity(), links: { next: "https://attacker.invalid/" } }; assert.equal((await verifyPatreonMembership(paged, policy, now)).evidence.verification, "review_required");
    const duplicate = identity(); duplicate.included.push(duplicate.included[0]); assert.equal((await verifyPatreonMembership(duplicate, policy, now)).evidence.verification, "review_required");
});
test("authoritative Discord identities never fall back to metadata or merge conflicting IDs", () => {
    assert.equal(currentDiscord({ identities: [], user_metadata: { provider_id: "123456789012345678" } }), null);
    assert.throws(() => currentDiscord({ user_metadata: { provider_id: "123456789012345678" } }));
    assert.throws(() => currentDiscord({ identities: [{ provider: "discord", identity_data: { sub: "123456789012345678", id: "999456789012345678" } }] }));
    assert.equal(identityStep(null), "signed_out"); assert.equal(identityStep({ identities: [] }), "needs_discord");
});
test("strict CP endpoint authenticates dedicated token and always fences exact authoritative Auth; outage cannot return positive", async () => {
    const calls: string[] = []; let outage = false; let deleted = false;
    const evidence = (await verifyPatreonMembership(identity(), policy, now)).evidence;
    const snapshot = { version: 1, accountId, discordUserId: "123456789012345678", patreonUserId: "1", linkGeneration: "1", revision: "1", linkState: "linked", ...evidence };
    const handler = createControlPlaneMembershipHandler({ supabaseUrl: "https://wfvqnijwuyqjibhlcrhz.supabase.co", serviceRoleKey: "synthetic-service-key", syncToken: "a".repeat(64), fetch: async (url, init) => {
        const path = new URL(String(url)).pathname; calls.push(path); assert.equal(init?.redirect, "error");
        if (path.startsWith("/auth/")) return outage ? new Response("outage", { status: 503 }) : deleted ? new Response("missing", { status: 404 }) : Response.json({ id: accountId, identities: [{ provider: "discord", identity_data: { sub: snapshot.discordUserId } }] });
        assert.equal(path, "/rest/v1/rpc/membership_fence");
        const input = JSON.parse(String(init?.body)); assert.equal(input.p_account_id, accountId); assert.equal(input.p_deleted, deleted);
        return Response.json(deleted ? { ...snapshot, discordUserId: null, patreonUserId: null, linkState: "account_deleted", verification: "unverified" } : snapshot);
    } });
    const request = (body: unknown, token = "a".repeat(64), origin?: string) => handler(new Request("https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/control-plane-membership-v1", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }));
    const body = { version: 1, operation: "snapshot", accountId };
    assert.equal((await request(body, "b".repeat(64))).status, 401); assert.equal((await request(body, "a".repeat(64), "https://site.test")).status, 403);
    for (const bad of [{ ...body, quota: 1 }, { ...body, accountId: accountId.toUpperCase() }, { version: 1, operation: "changes", cursor: null, limit: 51 }, { version: 1, operation: "sql", table: "anything" }]) assert.equal((await request(bad)).status, 400);
    assert.equal(calls.length, 0);
    assert.deepEqual(parseSnapshot(await (await request(body)).json()), snapshot);
    outage = true; assert.equal((await request(body)).status, 503); assert.equal(calls.filter(c => c.includes("membership_fence")).length, 1);
    outage = false; deleted = true; assert.equal((await (await request(body)).json()).linkState, "account_deleted");
});
test("website identity first, independent grant bypasses outage/configuration and expiry is exact", () => {
    const allocation = onboardingSummary();
    assert.equal(composeOnboarding(accountId, "needs_discord", null, allocation).status, "needs_discord");
    assert.equal(composeOnboarding(accountId, null, null, allocation).status, "eligible");
    const status = parseAccountStatus({ version: 1, accountId, hasDiscord: true, configured: true, verificationPending: false, membership: { linked: true, verification: "qualifying", sync: "applied", verifiedAt: now, validUntil: "2026-09-08T12:00:00.000Z", retryAt: null, refreshMode: "oauth_reauthorization" } }, accountId);
    allocation.sources.administrativeBase = 0; allocation.sources.membershipAllowance = 1;
    assert.equal(composeOnboarding(accountId, null, status, allocation, [], Date.parse(status.membership.validUntil!)-1).status, "eligible");
    assert.equal(composeOnboarding(accountId, null, status, allocation, [], Date.parse(status.membership.validUntil!)).status, "verification_expired");
    assert.equal(composeOnboarding(accountId, null, { ...status, verificationPending: true }, allocation).status, "verification_pending");
    assert.throws(() => parseAccountStatus({ ...status, campaignId: "10" }, accountId));
    assert.throws(() => parseAccountStatus(status, "bbbbbbbb-1111-4111-8111-111111111111"));
});
