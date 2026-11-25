import assert from "node:assert/strict";
import test from "node:test";
import type { HostingAdminVpsInventory } from "./control-plane/types";
import { supplementaryView, type SupplementaryReading } from "./reading-state";

/** A registered inventory, with or without live data, distinguished by its host names. */
function inventory(liveDataIncluded: boolean | undefined, ...names: string[]) {
    return { liveDataIncluded, hosts: names.map((name) => ({ name })) } as unknown as HostingAdminVpsInventory;
}

const complete = inventory(true, "host-a");

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
