import assert from "node:assert/strict";
import test from "node:test";
import type { HostingAdminVpsInventory } from "./types";
import {
    failedLiveInventoryReading,
    failedSupplementaryReading,
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
    for (const [name, reading, seed, initial, expected] of cases) assert.deepEqual(supplementaryView(reading, seed, initial), expected, name);
});

test("billing that resolves, then fails after a refreshed inventory, still shows its last result with the error", () => {
    const billing = inventory(false, "billing");
    const resolved: SupplementaryReading<HostingAdminVpsInventory> = { result: billing };
    const failed = failedSupplementaryReading(resolved, "Billing readings timed out.");
    assert.deepEqual(supplementaryView(failed, undefined, refreshed), { result: billing, error: "Billing readings timed out.", pending: false });
    assert.deepEqual(failedSupplementaryReading(undefined, "Down."), { result: undefined, error: "Down." });
});
