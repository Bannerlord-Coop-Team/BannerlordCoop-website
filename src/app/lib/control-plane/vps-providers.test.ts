import assert from "node:assert/strict";
import test from "node:test";
import { failedVpsProviderReadsMessage, isVpsProviderId, parseVpsHostSelection, vpsHostSelectionValue, vpsProviderLabel } from "./vps-providers";

test("a host selection round-trips its provider with its service name", () => {
    const value = vpsHostSelectionValue({ provider: "contabo-vps", serviceName: "203779521" });
    assert.deepEqual(parseVpsHostSelection(value), { provider: "contabo-vps", serviceName: "203779521" });
});

test("only the manual VPS providers are accepted", () => {
    assert.equal(isVpsProviderId("ovhcloud-vps"), true);
    assert.equal(isVpsProviderId("contabo-vps"), true);
    assert.equal(isVpsProviderId("ionos-cloud"), false);
    assert.equal(isVpsProviderId("experiment-host"), false);
});

test("a selection without a known provider is rejected instead of guessed", () => {
    assert.throws(() => parseVpsHostSelection("vps-123.vps.ovh.net"), /Choose a VPS/u);
    assert.throws(() => parseVpsHostSelection(JSON.stringify({ serviceName: "vps-123" })), /unknown provider/u);
    assert.throws(() => parseVpsHostSelection(JSON.stringify({ provider: "ionos-cloud", serviceName: "x" })), /unknown provider/u);
    assert.throws(() => parseVpsHostSelection(JSON.stringify({ provider: "ovhcloud-vps", serviceName: "" })), /invalid service name/u);
    assert.throws(() => parseVpsHostSelection(undefined), /Choose a VPS/u);
});

test("provider labels name the catalog providers and show retired ids verbatim", () => {
    assert.equal(vpsProviderLabel("ovhcloud-vps"), "OVHcloud");
    assert.equal(vpsProviderLabel("contabo-vps"), "Contabo");
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
