import assert from "node:assert/strict";
import { test } from "node:test";
import type { LossBreaker, LossBreakerVerdict, MassLossAlert } from "../_shared/loss-breaker.ts";
import { staticCreatorToken } from "../_shared/patreon-creator-token.ts";
import { createPatreonRoleHandler } from "../_shared/patreon-roles.ts";
import { lossBreakerDatabase } from "../../../tests/loss-breaker-database.ts";

const campaign = "12345", tier = "28995946", syncSecret = "patreon-sync-secret-fixture", webhookSecret = "patreon-webhook-secret-fixture";
const token = "aaaaaaaa-1111-4111-8111-111111111111";
const policy = { campaignId: campaign, qualifyingTierIds: [tier], currency: "USD" as const, minimumCents: 5000 as const, policyVersion: "patreon-paid-usd50-v1" as const };
const memberId = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
const accountId = (i: number) => `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`;

// Builds one creator member read: a $50 qualifying patron, or one with no tier left (a former patron,
// or with `emptyTiers` an active $50 patron whose tiers an API glitch dropped).
function memberRead(id: string, qualifying: boolean, emptyTiers = false) {
    const active = qualifying || emptyTiers;
    return { data: { type: "member", id,
        attributes: { patron_status: active ? "active_patron" : "former_patron", last_charge_status: "Paid", last_charge_date: "2026-09-01T00:00:00Z",
            currently_entitled_amount_cents: active ? 5000 : 0, is_free_trial: false, is_gifted: false },
        relationships: { campaign: { data: { type: "campaign", id: campaign } }, user: { data: { type: "user", id: "123" } },
            currently_entitled_tiers: { data: qualifying ? [{ type: "tier", id: tier }] : [] } } },
        included: [{ type: "campaign", id: campaign, attributes: { currency: "USD" } },
            { type: "tier", id: tier, attributes: { amount_cents: 5000 }, relationships: { campaign: { data: { type: "campaign", id: campaign } } } }] };
}

type Run = { lapsing: number; renewing: number; breaker?: LossBreaker; alreadyLost?: boolean; emptyTiers?: boolean; first?: number };
// Runs one worker pass over `lapsing` newly lost and `renewing` qualifying linked members, numbered from `first`.
async function run({ lapsing, renewing, breaker, alreadyLost = false, emptyTiers = false, first = 0 }: Run) {
    const completes: Record<string, unknown>[] = [], alerts: MassLossAlert[] = [], reported: string[][] = [];
    const handler = createPatreonRoleHandler({ campaignId: campaign, tierId: tier, allocationPolicy: policy, creatorToken: staticCreatorToken("fixture-creator-token"),
        syncSecret, webhookSecret, alert: async kind => { alerts.push(kind); },
        ...(breaker ? { lossBreaker: async (lease: string, ids: string[]) => { reported.push(ids); return breaker(lease, ids); } } : {}),
        rpc: async (operation, input) => {
            if (operation === "acquire") return { token, scanDue: false, allocationPolicyVersion: policy.policyVersion, allocationVerifiedAt: new Date().toISOString(),
                jobs: Array.from({ length: lapsing + renewing }, (_, i) => ({ memberId: memberId(first + i), generation: 1,
                    allocationFence: { accountId: accountId(first + i), generation: "1", revision: "1" }, allocationLost: alreadyLost && i < lapsing })) };
            if (operation === "complete") completes.push(input);
            return {};
        },
        fetchImplementation: async input => {
            const id = new URL(String(input)).pathname.split("/").at(-1)!;
            return Response.json(memberRead(id, Number(id.slice(-12)) - first >= lapsing, emptyTiers));
        } });
    const response = await handler(new Request("https://edge.invalid/patreon-roles", { method: "POST", headers: { "x-patreon-sync-key": syncSecret } }));
    assert.equal(response.status, 200);
    const evidence = completes.map(input => input.allocationEvidence as { verification: string; paidAccessEndedAt?: string } | undefined);
    return { reported, alerts, losses: evidence.filter(row => row?.paidAccessEndedAt !== undefined).length,
        qualifying: evidence.filter(row => row?.verification === "qualifying").length, withheld: evidence.filter(row => row === undefined).length };
}
// A fake breaker answering one fixed verdict.
const answering = (verdict: LossBreakerVerdict): LossBreaker => async () => verdict;
const ids = (count: number, first = 0) => Array.from({ length: count }, (_, i) => accountId(first + i));

test("a Patreon run reports its newly lost accounts and withholds only their loss when the breaker says so", async () => {
    assert.deepEqual(await run({ lapsing: 6, renewing: 14, breaker: answering({ withhold: true, bypass: false, alert: true }) }),
        { reported: [ids(6)], alerts: ["mass_loss_tripped"], losses: 0, qualifying: 14, withheld: 6 });
    assert.deepEqual(await run({ lapsing: 6, renewing: 14, breaker: answering({ withhold: true, bypass: false, alert: false }) }),
        { reported: [ids(6)], alerts: [], losses: 0, qualifying: 14, withheld: 6 }, "a throttled trip still withholds");
    assert.deepEqual(await run({ lapsing: 6, renewing: 14, breaker: answering({ withhold: false, bypass: true, alert: true }) }),
        { reported: [ids(6)], alerts: ["mass_loss_allowed"], losses: 6, qualifying: 14, withheld: 0 }, "an allowance writes the loss and still alerts");
    assert.deepEqual(await run({ lapsing: 1, renewing: 3, breaker: answering({ withhold: false, bypass: false, alert: false }) }),
        { reported: [ids(1)], alerts: [], losses: 1, qualifying: 3, withheld: 0 }, "an untripped window writes the loss");
    assert.deepEqual(await run({ lapsing: 0, renewing: 4, breaker: answering({ withhold: true, bypass: false, alert: true }) }),
        { reported: [], alerts: [], losses: 0, qualifying: 4, withheld: 0 }, "a run without new loss never asks");
    assert.deepEqual((await run({ lapsing: 6, renewing: 14, alreadyLost: true, breaker: answering({ withhold: true, bypass: false, alert: true }) })).reported, [], "recorded loss is not new");
    assert.deepEqual(await run({ lapsing: 1, renewing: 1 }), { reported: [], alerts: [], losses: 0, qualifying: 1, withheld: 1 }, "without a breaker new loss is withheld");
});

test("the real breaker freezes an empty-tier glitch and small runs that together pass 25% of the linked members", async () => {
    const { db, link, lease, breaker } = await lossBreakerDatabase();
    try {
        await lease("patreon", token);
        await link("patreon", 20);
        // No custom pledges exist, so one tierless active patron is loss; many at once look like a glitch.
        assert.equal((await run({ lapsing: 1, renewing: 0, emptyTiers: true, breaker: breaker("patreon") })).losses, 1, "one tierless patron is loss");
        assert.deepEqual(await run({ lapsing: 15, renewing: 5, emptyTiers: true, first: 100, breaker: breaker("patreon") }),
            { reported: [ids(15, 100)], alerts: ["mass_loss_tripped"], losses: 0, qualifying: 5, withheld: 15 }, "15 of 20 suddenly tierless trips");
        await db.exec("truncate public.membership_loss_observations; update public.membership_loss_breakers set alerted_at = null");
        // Runs of 3 reads, each far below a 10-read floor, still trip once 6 of the 20 linked members newly lost.
        for (const first of [200, 210]) assert.equal((await run({ lapsing: 2, renewing: 1, first, breaker: breaker("patreon") })).losses, 2, `run from ${first}`);
        assert.deepEqual(await run({ lapsing: 2, renewing: 1, first: 220, breaker: breaker("patreon") }),
            { reported: [ids(2, 220)], alerts: ["mass_loss_tripped"], losses: 0, qualifying: 1, withheld: 2 });
    } finally {
        await db.close();
    }
});
