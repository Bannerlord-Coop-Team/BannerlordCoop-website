import assert from "node:assert/strict";
import { test } from "node:test";
import { MASS_LOSS_FRACTION, MASS_LOSS_MINIMUM_SAMPLE, massLossTripped } from "../_shared/loss-breaker.ts";
import { staticCreatorToken } from "../_shared/patreon-creator-token.ts";
import { createPatreonRoleHandler } from "../_shared/patreon-roles.ts";

const campaign = "12345", tier = "28995946", syncSecret = "patreon-sync-secret-fixture", webhookSecret = "patreon-webhook-secret-fixture";
const policy = { campaignId: campaign, qualifyingTierIds: [tier], currency: "USD" as const, minimumCents: 5000 as const, policyVersion: "patreon-paid-usd50-v1" as const };
const memberId = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;

// Builds one creator member read: a $50 qualifying patron, or a former patron with no tier left.
function memberRead(id: string, qualifying: boolean) {
    return { data: { type: "member", id,
        attributes: { patron_status: qualifying ? "active_patron" : "former_patron", last_charge_status: "Paid", last_charge_date: "2026-09-01T00:00:00Z",
            currently_entitled_amount_cents: qualifying ? 5000 : 0, is_free_trial: false, is_gifted: false },
        relationships: { campaign: { data: { type: "campaign", id: campaign } }, user: { data: { type: "user", id: "123" } },
            currently_entitled_tiers: { data: qualifying ? [{ type: "tier", id: tier }] : [] } } },
        included: [{ type: "campaign", id: campaign, attributes: { currency: "USD" } },
            { type: "tier", id: tier, attributes: { amount_cents: 5000 }, relationships: { campaign: { data: { type: "campaign", id: campaign } } } }] };
}

// Runs one worker pass over `lapsing` newly lost and `renewing` qualifying linked members.
async function run(lapsing: number, renewing: number, breakerReply = { bypass: false, alert: true }, alreadyLost = false) {
    const total = lapsing + renewing;
    const completes: Record<string, unknown>[] = [];
    let trips = 0, alerts = 0;
    const handler = createPatreonRoleHandler({ campaignId: campaign, tierId: tier, allocationPolicy: policy, creatorToken: staticCreatorToken("fixture-creator-token"),
        syncSecret, webhookSecret, alert: async () => { alerts++; }, lossBreaker: async () => { trips++; return breakerReply; },
        rpc: async (operation, input) => {
            if (operation === "acquire") return { token: "aaaaaaaa-1111-4111-8111-111111111111", scanDue: false, allocationPolicyVersion: policy.policyVersion,
                allocationVerifiedAt: new Date().toISOString(), jobs: Array.from({ length: total }, (_, i) => ({ memberId: memberId(i), generation: 1,
                    allocationFence: { accountId: memberId(i), generation: "1", revision: "1" }, allocationLost: alreadyLost && i < lapsing })) };
            if (operation === "complete") completes.push(input);
            return {};
        },
        fetchImplementation: async input => {
            const id = new URL(String(input)).pathname.split("/").at(-1)!;
            return Response.json(memberRead(id, Number(id.slice(-12)) >= lapsing));
        } });
    const response = await handler(new Request("https://edge.invalid/patreon-roles", { method: "POST", headers: { "x-patreon-sync-key": syncSecret } }));
    assert.equal(response.status, 200);
    const evidence = completes.map(input => input.allocationEvidence as { verification: string; paidAccessEndedAt?: string } | undefined);
    return { trips, alerts, completed: completes.length, losses: evidence.filter(row => row?.paidAccessEndedAt !== undefined).length,
        qualifying: evidence.filter(row => row?.verification === "qualifying").length, withheld: evidence.filter(row => row === undefined).length };
}

test("the shared breaker trips only above its fraction of a large enough sample", () => {
    assert.deepEqual([MASS_LOSS_FRACTION, MASS_LOSS_MINIMUM_SAMPLE], [0.25, 10]);
    assert.equal(massLossTripped(9, 9), false, "a run under the minimum sample never trips");
    assert.equal(massLossTripped(3, 12), false, "exactly 25% does not trip");
    assert.equal(massLossTripped(4, 12), true);
    assert.equal(massLossTripped(6, 20), true);
    assert.equal(massLossTripped(5, 20), false);
});

test("a Patreon run that newly loses too many linked members completes them without loss evidence and still writes renewals", async () => {
    assert.deepEqual(await run(6, 14), { trips: 1, alerts: 1, completed: 20, losses: 0, qualifying: 14, withheld: 6 }, "6 of 20 trips");
    assert.deepEqual(await run(6, 14, { bypass: false, alert: false }), { trips: 1, alerts: 0, completed: 20, losses: 0, qualifying: 14, withheld: 6 }, "a throttled trip still withholds");
    assert.deepEqual(await run(5, 15), { trips: 0, alerts: 0, completed: 20, losses: 5, qualifying: 15, withheld: 0 }, "5 of 20 is under the threshold");
    assert.deepEqual(await run(1, 0), { trips: 0, alerts: 0, completed: 1, losses: 1, qualifying: 0, withheld: 0 }, "one real loss in a small run is written");
    assert.deepEqual(await run(9, 0), { trips: 0, alerts: 0, completed: 9, losses: 9, qualifying: 0, withheld: 0 }, "fewer than 10 linked never trips");
    assert.deepEqual(await run(6, 14, undefined, true), { trips: 0, alerts: 0, completed: 20, losses: 6, qualifying: 14, withheld: 0 }, "loss already recorded is not new");
    assert.deepEqual(await run(6, 14, { bypass: true, alert: false }), { trips: 1, alerts: 0, completed: 20, losses: 6, qualifying: 14, withheld: 0 }, "an operator window writes the loss");
});
