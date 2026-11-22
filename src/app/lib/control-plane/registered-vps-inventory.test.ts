import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlPlaneAdminError } from "./client";
import { readRegisteredVpsInventory } from "./registered-vps-inventory";
import type { HostingAdminVpsInventory } from "./types";

function page(names: string[], nextCursor: string | null, liveDataIncluded = false): HostingAdminVpsInventory {
    return { hosts: names.map(name => ({ name }) as HostingAdminVpsInventory["hosts"][number]),
        nextCursor, liveDataIncluded, controlPlaneHost: null, availableHosts: [] };
}

for (const includeLiveData of [false, true]) {
    test(`negotiates the old VPS request shape in mode ${includeLiveData}`, async () => {
        const calls: unknown[] = [];
        const legacy = page(["old-host"], null, includeLiveData);
        delete legacy.nextCursor;
        const result = await readRegisteredVpsInventory(async input => {
            calls.push(input);
            if (calls.length === 1) throw new ControlPlaneAdminError("invalid_request", "Unsupported page option");
            return legacy;
        }, includeLiveData);
        assert.deepEqual(result, legacy);
        assert.deepEqual(calls, [
            { includeLiveData, includeProviderInventory: false, storedAfter: null },
            includeLiveData ? { includeLiveData: true, includeProviderInventory: false } : { includeLiveData: false },
        ]);
    });
}

test("restarts from an empty cursor and discards pages of the changed revision", async () => {
    const calls: unknown[] = [];
    const result = await readRegisteredVpsInventory(async input => {
        calls.push(input);
        switch (calls.length) {
            case 1: return page(["before"], "before-token");
            case 2: throw new ControlPlaneAdminError("vps_inventory_changed", "Start a new scan");
            case 3: return page(["after"], "after-token");
            case 4: return page(["last"], null);
            default: throw new Error("Unexpected VPS request");
        }
    }, false);
    assert.deepEqual(result.hosts.map(host => host.name), ["after", "last"]);
    assert.equal(result.nextCursor, null);
    assert.deepEqual(calls, [null, "before-token", null, "after-token"].map(storedAfter =>
        ({ includeLiveData: false, includeProviderInventory: false, storedAfter })));
});

test("never converts a continuation error into a bulk request", async () => {
    let calls = 0;
    await assert.rejects(readRegisteredVpsInventory(async () => {
        if (++calls === 1) return page(["first"], "continue");
        throw new ControlPlaneAdminError("invalid_request", "Invalid continuation");
    }, false), { code: "invalid_request" });
    assert.equal(calls, 2);
});

test("rejects a missing terminal cursor, duplicate host, or repeated token", async () => {
    const missing = page(["first"], null);
    delete missing.nextCursor;
    const first = page(["first"], "continue");
    for (const second of [missing, page(["first"], null), page(["second"], "continue")]) {
        let calls = 0;
        await assert.rejects(readRegisteredVpsInventory(async () =>
            ++calls === 1 ? first : second, false), { code: "invalid_response" });
        assert.equal(calls, 2);
    }
});
