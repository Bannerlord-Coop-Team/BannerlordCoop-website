import assert from "node:assert/strict";
import test from "node:test";
import {
    createManagedServerIdentity,
    IONOS_MANAGED_DATACENTER_DESCRIPTION,
    IONOS_MANAGED_DATACENTER_NAME,
    getIonosServerPreset,
    getIonosServerPresetFromName,
    isIonosLocationId,
    isIonosResourceId,
    isIonosServerPreset,
    isManagedDatacenter,
    isManagedServerName,
    isSshPublicKey,
} from "./resources";

test("recognizes IONOS resource IDs", () => {
    assert.equal(isIonosResourceId("2f1c342c-6904-4ab5-8d12-a7d2b3c4d5e6"), true);
    assert.equal(isIonosResourceId("../../other-server"), false);
    assert.equal(isIonosResourceId("not-a-resource-id"), false);
});

test("validates selectable presets, regions, and SSH public keys", () => {
    assert.equal(isIonosServerPreset("Standard"), true);
    assert.equal(isIonosServerPreset("Premium"), true);
    assert.equal(isIonosServerPreset("Enterprise"), false);
    assert.deepEqual(getIonosServerPreset("Standard"), {
        cores: 2,
        ramMb: 4096,
        storageGb: 120,
        templateName: "Basic Cube S",
    });
    assert.deepEqual(getIonosServerPreset("Premium"), {
        cores: 4,
        ramMb: 8192,
        storageGb: 240,
        templateName: "Basic Cube M",
    });
    assert.equal(
        getIonosServerPresetFromName("bannerlord-coop-standard-20260821-a1b2c3d4"),
        "Standard",
    );
    assert.equal(
        getIonosServerPresetFromName("bannerlord-coop-premium-20260821-a1b2c3d4"),
        "Premium",
    );
    assert.equal(getIonosServerPresetFromName("bannerlord-coop-legacy"), null);

    assert.equal(isIonosLocationId("de/fra"), true);
    assert.equal(isIonosLocationId("de/fra/2"), true);
    assert.equal(isIonosLocationId("../../other"), false);

    assert.equal(isSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGoodKey admin@example.com"), true);
    assert.equal(isSshPublicKey("-----BEGIN OPENSSH PRIVATE KEY-----"), false);
    assert.equal(isSshPublicKey("not-a-public-key"), false);
});

test("restricts mutations to website-managed resources", () => {
    assert.equal(
        isManagedDatacenter({
            description: IONOS_MANAGED_DATACENTER_DESCRIPTION,
            name: IONOS_MANAGED_DATACENTER_NAME,
        }),
        true,
    );
    assert.equal(
        isManagedDatacenter({
            description: "Production resources",
            name: IONOS_MANAGED_DATACENTER_NAME,
        }),
        false,
    );
    assert.equal(isManagedServerName("bannerlord-coop-20260821-a1b2c3d4"), true);
    assert.equal(isManagedServerName("unrelated-production-server"), false);
});

test("creates provider-safe managed server names", () => {
    const identity = createManagedServerIdentity(
        new Date("2026-08-21T12:00:00.000Z"),
        "A1B2-C3D4-E5F6",
        "Premium",
    );

    assert.deepEqual(identity, {
        hostname: "bannerlord-coop-premium-20260821-a1b2c3d4",
        name: "bannerlord-coop-premium-20260821-a1b2c3d4",
    });
});
