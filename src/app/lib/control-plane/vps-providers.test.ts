import assert from "node:assert/strict";
import test from "node:test";
import { failedVpsProviderReadsMessage, isVpsProviderId, parseVpsHostSelection, VPS_PROVIDERS, vpsHostSelectionValue, vpsProviderLabel } from "./vps-providers";

test("a host selection round-trips its provider with its service name", () => {
    const value = vpsHostSelectionValue({ provider: "contabo-vps", serviceName: "203779521" });
    assert.deepEqual(parseVpsHostSelection(value), { provider: "contabo-vps", serviceName: "203779521" });
});

test("the catalog is exactly the control plane's VPS providers, in its order", () => {
    assert.deepEqual(VPS_PROVIDERS, ["ovhcloud-vps", "contabo-vps", "hosthatch-vps", "vpstc-vps"]);
});

test("only the control plane's VPS providers are accepted", () => {
    for (const id of VPS_PROVIDERS) assert.equal(isVpsProviderId(id), true, id);
    assert.equal(isVpsProviderId("ionos-cloud"), false);
    assert.equal(isVpsProviderId("VPSTC-VPS"), false);
    assert.equal(isVpsProviderId("experiment-host"), false);
});

test("a manual-entry host's selection round-trips too", () => {
    const value = vpsHostSelectionValue({ provider: "vpstc-vps", serviceName: "vpstc-ist-1" });
    assert.deepEqual(parseVpsHostSelection(value), { provider: "vpstc-vps", serviceName: "vpstc-ist-1" });
});

test("a selection without a known provider is rejected instead of guessed", () => {
    assert.throws(() => parseVpsHostSelection("vps-123.vps.ovh.net"), /Choose a VPS/u);
    assert.throws(() => parseVpsHostSelection(JSON.stringify({ serviceName: "vps-123" })), /unknown provider/u);
    assert.throws(() => parseVpsHostSelection(JSON.stringify({ provider: "ionos-cloud", serviceName: "x" })), /unknown provider/u);
    assert.throws(() => parseVpsHostSelection(JSON.stringify({ provider: "ovhcloud-vps", serviceName: "" })), /invalid service name/u);
    assert.throws(() => parseVpsHostSelection(undefined), /Choose a VPS/u);
});

test("provider labels name the catalog providers and show retired ids verbatim", () => {
    assert.deepEqual(VPS_PROVIDERS.map(vpsProviderLabel), ["OVHcloud", "Contabo", "HostHatch", "VPS.TC"]);
    assert.equal(vpsProviderLabel("experiment-host"), "experiment-host");
});

test("failed provider reads are named; successful or absent reads are not reported", () => {
    assert.equal(failedVpsProviderReadsMessage(undefined), null);
    assert.equal(failedVpsProviderReadsMessage([{ provider: "ovhcloud-vps", status: "ok", code: null }]), null);
    assert.match(failedVpsProviderReadsMessage([
        { provider: "ovhcloud-vps", status: "failed", code: "authorization" },
        { provider: "contabo-vps", status: "failed", code: null },
    ]) ?? "", /^The OVHcloud \(authorization\), Contabo account reads failed/u);
});
