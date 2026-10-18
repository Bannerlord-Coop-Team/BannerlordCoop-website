import assert from "node:assert/strict";
import test from "node:test";
import { isVpsProviderId, parseVpsHostSelection, vpsHostSelectionValue } from "./vps-providers";

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
