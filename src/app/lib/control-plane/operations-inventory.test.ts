import assert from "node:assert/strict";
import test from "node:test";
import { ControlPlaneAdminError } from "./client";
import { readOperationsVpsInventory, type VpsInventoryOptions } from "./operations-inventory";
import type { HostingAdminVpsInventory } from "./types";

const local = { liveDataIncluded: false, hosts: [], availableServiceNames: [] } as unknown as HostingAdminVpsInventory;

test("an OVH account failure degrades to local inventory with the failure reason", async () => {
    const requests: VpsInventoryOptions[] = [];
    const result = await readOperationsVpsInventory(async (input) => {
        requests.push(input);
        if (input.includeProviderInventory) {
            throw new ControlPlaneAdminError("runtime_unavailable", "Managed-hosting runtime configuration is unavailable.");
        }
        return local;
    });
    assert.equal(result.inventory, local);
    assert.equal(result.providerError, "Managed-hosting runtime configuration is unavailable.");
    assert.deepEqual(requests.map((input) => input.includeProviderInventory), ["service-names", false]);
});

test("a failed local fallback still rejects so an unreachable control plane is reported", async () => {
    await assert.rejects(readOperationsVpsInventory(async () => {
        throw new ControlPlaneAdminError("control_plane_unavailable", "down");
    }), /down/);
});
