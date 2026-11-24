import assert from "node:assert/strict";
import test from "node:test";
import type { HostingAdminVpsInventory } from "./types";
import {
    failedLiveInventoryReading,
    failedSupplementaryReading,
    billingReadState,
    liveDataMismatchError,
    liveInventoryView,
    supplementaryView,
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

test("supplementary readings keep their result and error regardless of the inventory", () => {
    const billing = inventory(false, "billing");
    const cases: Array<[string, SupplementaryReading<HostingAdminVpsInventory | null> | undefined, HostingAdminVpsInventory | undefined, HostingAdminVpsInventory, ReturnType<typeof supplementaryView>]> = [
        ["no read yet", undefined, undefined, registered, { result: undefined, error: undefined, pending: true }],
        ["no read, complete inventory seeds it", undefined, complete, complete, { result: complete, error: undefined, pending: false }],
        ["read, then a refreshed inventory", { result: billing }, undefined, refreshed, { result: billing, error: undefined, pending: false }],
        ["a null result overrides the seed", { result: null }, complete, complete, { result: null, error: undefined, pending: false }],
        ["failed first read", { error: "Down." }, undefined, registered, { result: undefined, error: "Down.", pending: false }],
    ];
    for (const [name, reading, seed, initial, expected] of cases) assert.deepEqual(supplementaryView(reading, seed, initial.liveDataIncluded === false), expected, name);
});

test("a failed supplementary read keeps its last result", () => {
    const billing = inventory(false, "billing");
    assert.deepEqual(failedSupplementaryReading({ result: billing }, "Down."), { result: billing, error: "Down." });
    assert.deepEqual(failedSupplementaryReading(undefined, "Down."), { result: undefined, error: "Down." });
});

test("a live-data mismatch names which way the response differs from the request", () => {
    assert.equal(liveDataMismatchError({ liveDataIncluded: true }, true), null);
    assert.equal(liveDataMismatchError({ liveDataIncluded: false }, false), null);
    assert.equal(liveDataMismatchError({ liveDataIncluded: false }, true), "Live VPS data is unavailable.");
    assert.equal(liveDataMismatchError({ liveDataIncluded: undefined }, true), "Live VPS data is unavailable.");
    assert.equal(liveDataMismatchError({ liveDataIncluded: true }, false), "The provider inventory read returned an unexpected live-data response.");
});

test("the billing read state applies loading, failed, stale, partial, then ok precedence", () => {
    const billing = inventory(false, "billing");
    const partial = { ...billing, providerReads: [{ provider: "contabo-vps", status: "failed", code: null }] } as HostingAdminVpsInventory;
    const cases: Array<[string, Parameters<typeof billingReadState>[0], ReturnType<typeof billingReadState>]> = [
        ["first read loading", { pending: true }, { kind: "loading" }],
        ["failed with nothing to show", { pending: false, error: "Down." }, { kind: "failed", error: "Down." }],
        ["failed after an earlier result", { pending: false, result: partial, error: "Down." }, { kind: "stale", error: "Down." }],
        ["some provider accounts failed", { pending: false, result: partial }, { kind: "partial", failedProviderReads: "The Contabo account read failed, so that provider's unregistered VPS products and billing are not shown." }],
        ["complete", { pending: false, result: billing }, { kind: "ok" }],
    ];
    for (const [name, reading, expected] of cases) assert.deepEqual(billingReadState(reading), expected, name);
});
