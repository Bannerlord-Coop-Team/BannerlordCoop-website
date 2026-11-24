import assert from "node:assert/strict";
import test from "node:test";
import type { HostingAdminVpsAvailableHost, HostingAdminVpsInventory } from "./types";
import {
    billingListedHosts,
    billingReadState,
    failedLiveInventoryReading,
    liveDataMismatchError,
    liveInventoryView,
    supplementaryView,
    unlistedHostsError,
    type LiveInventoryReading,
    type SupplementaryReading,
} from "./vps-readings";

/** A registered inventory, with or without live data, distinguished by its host names. */
function inventory(liveDataIncluded: boolean | undefined, ...names: string[]) {
    return { liveDataIncluded, hosts: names.map((name) => ({ name })) } as unknown as HostingAdminVpsInventory;
}

const registered = inventory(false, "host-a");
const refreshed = inventory(false, "host-a", "host-new");
const complete = inventory(true, "host-a");
const live = inventory(true, "host-a");

test("live telemetry shows only a reading for the same inventory", () => {
    const cases: Array<[string, LiveInventoryReading | undefined, HostingAdminVpsInventory, ReturnType<typeof liveInventoryView>]> = [
        ["no read yet", undefined, registered, { result: undefined, error: undefined, pending: true }],
        ["read for this inventory", { initial: registered, result: live }, registered, { result: live, error: undefined, pending: false }],
        ["read for an older inventory", { initial: registered, result: live }, refreshed, { result: undefined, error: undefined, pending: true }],
        ["complete inventory, no read", undefined, complete, { result: complete, error: undefined, pending: false }],
        ["failed read for this inventory", { initial: registered, error: "Down." }, registered, { result: undefined, error: "Down.", pending: false }],
    ];
    for (const [name, reading, initial, expected] of cases) assert.deepEqual(liveInventoryView(reading, initial), expected, name);
});

test("a failed live read keeps only a result for the same inventory", () => {
    assert.deepEqual(failedLiveInventoryReading({ initial: registered, result: live }, registered, "Down."), { initial: registered, result: live, error: "Down." });
    assert.deepEqual(failedLiveInventoryReading({ initial: registered, result: live }, refreshed, "Down."), { initial: refreshed, result: undefined, error: "Down." });
    assert.deepEqual(failedLiveInventoryReading(undefined, registered, "Down."), { initial: registered, result: undefined, error: "Down." });
});

test("supplementary readings show their last result, else the seed, and are pending only before the first read", () => {
    const billing = inventory(false, "billing");
    const cases: Array<[string, SupplementaryReading<HostingAdminVpsInventory | null> | undefined, HostingAdminVpsInventory | undefined, boolean, ReturnType<typeof supplementaryView>]> = [
        ["no read yet", undefined, undefined, true, { result: undefined, error: undefined, pending: true }],
        ["no read, complete inventory seeds it", undefined, complete, false, { result: complete, error: undefined, pending: false }],
        ["read, then a refreshed inventory", { result: billing }, undefined, true, { result: billing, error: undefined, pending: false }],
        ["a null result overrides the seed", { result: null }, complete, false, { result: null, error: undefined, pending: false }],
        ["failed first read", { error: "Down." }, undefined, true, { result: undefined, error: "Down.", pending: false }],
    ];
    for (const [name, reading, seed, awaitingLiveData, expected] of cases) assert.deepEqual(supplementaryView(reading, seed, awaitingLiveData), expected, name);
});

test("a live-data mismatch names which way the response differs from the request", () => {
    assert.equal(liveDataMismatchError({ liveDataIncluded: true }, true), null);
    assert.equal(liveDataMismatchError({ liveDataIncluded: false }, false), null);
    assert.equal(liveDataMismatchError({ liveDataIncluded: false }, true), "Live VPS data is unavailable.");
    assert.equal(liveDataMismatchError({ liveDataIncluded: undefined }, true), "Live VPS data is unavailable.");
    assert.equal(liveDataMismatchError({ liveDataIncluded: true }, false), "The provider inventory read returned an unexpected live-data response.");
});

test("a provider-inventory response must list a host array", () => {
    assert.equal(unlistedHostsError({ availableHosts: [] }, true), null);
    assert.equal(unlistedHostsError({ availableHosts: "not-a-list" } as unknown as HostingAdminVpsInventory, false), null);
    assert.equal(unlistedHostsError({ availableHosts: "not-a-list" } as unknown as HostingAdminVpsInventory, true), "The provider account inventory response did not list hosts.");
});

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
