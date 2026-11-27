import assert from "node:assert/strict";
import test from "node:test";
import type { HostingAdminVpsAvailableHost, HostingAdminVpsInventory } from "./types";
import { billingListedHosts, billingReadState } from "./vps-billing-state";

/** A registered inventory, with or without live data, distinguished by its host names. */
function inventory(liveDataIncluded: boolean | undefined, ...names: string[]) {
    return { liveDataIncluded, hosts: names.map((name) => ({ name })) } as unknown as HostingAdminVpsInventory;
}

test("the billing read state applies loading, failed, stale, partial, then ok precedence, carrying the listed hosts", () => {
    const host = { provider: "contabo-vps", serviceName: "203779521", label: "Contabo VPS · 203779521" } as HostingAdminVpsAvailableHost;
    const billing = { ...inventory(false, "billing"), availableHosts: [host] } as HostingAdminVpsInventory;
    const partial = { ...billing, providerReads: [{ provider: "contabo-vps", status: "failed", code: null }] } as HostingAdminVpsInventory;
    const seededWithoutList = { ...inventory(true, "legacy"), availableHosts: undefined } as unknown as HostingAdminVpsInventory;
    const cases: Array<[string, Parameters<typeof billingReadState>[0], ReturnType<typeof billingReadState>]> = [
        ["first read loading", { pending: true }, { kind: "loading" }],
        ["failed with nothing to show", { pending: false, error: "Down." }, { kind: "failed", error: "Down." }],
        ["failed after an earlier result", { pending: false, result: partial, error: "Down." }, { kind: "stale", error: "Down.", availableHosts: [host] }],
        ["some provider accounts failed", { pending: false, result: partial }, { kind: "partial", failedProviderReads: "The Contabo account read failed, so that provider's unregistered VPS products and billing are not shown.", availableHosts: [host] }],
        ["complete", { pending: false, result: billing }, { kind: "ok", availableHosts: [host] }],
        ["an older backend's seeded inventory without a list", { pending: false, result: seededWithoutList }, { kind: "ok", availableHosts: [] }],
    ];
    for (const [name, reading, expected] of cases) assert.deepEqual(billingReadState(reading), expected, name);
    assert.equal(billingListedHosts({ kind: "loading" }), null);
    assert.equal(billingListedHosts({ kind: "failed", error: "Down." }), null);
    assert.deepEqual(billingListedHosts({ kind: "ok", availableHosts: [host] }), [host]);
});
