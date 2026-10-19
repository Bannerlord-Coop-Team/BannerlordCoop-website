import assert from "node:assert/strict";
import test from "node:test";
import { ControlPlaneAdminError } from "./client";
import { readOperationsVpsInventory, type VpsInventoryOptions } from "./operations-inventory";
import type { HostingAdminVpsInventory } from "./types";

const local = { liveDataIncluded: false, hosts: [], availableHosts: [] } as unknown as HostingAdminVpsInventory;

test("a provider account failure degrades to local inventory with the failure reason", async () => {
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

test("one failed provider account read is reported while the other providers' hosts stay listed", async () => {
    const inventory = { ...local, availableHosts: [{ provider: "ovhcloud-vps", serviceName: "vps-1", label: "OVHcloud · vps-1" }],
        providerReads: [{ provider: "ovhcloud-vps", status: "ok", code: null }, { provider: "contabo-vps", status: "failed", code: "transport" }] } as HostingAdminVpsInventory;
    const result = await readOperationsVpsInventory(async () => inventory);
    assert.equal(result.inventory, inventory);
    assert.match(result.providerError ?? "", /Contabo \(transport\) account read failed/u);
});

test("successful provider account reads report no error", async () => {
    const inventory = { ...local, providerReads: [{ provider: "contabo-vps", status: "ok", code: null }] } as HostingAdminVpsInventory;
    assert.equal((await readOperationsVpsInventory(async () => inventory)).providerError, null);
});

test("a failed local fallback still rejects so an unreachable control plane is reported", async () => {
    await assert.rejects(readOperationsVpsInventory(async () => {
        throw new ControlPlaneAdminError("control_plane_unavailable", "down");
    }), /down/);
});
