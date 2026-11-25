import assert from "node:assert/strict";
import test from "node:test";
import type { HostingAdminVpsInventory } from "@/app/lib/control-plane/types";
import { failedLiveInventoryReading, liveInventoryView, type LiveInventoryReading } from "./live-inventory-reading";

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
