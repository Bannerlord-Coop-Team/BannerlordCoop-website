import assert from "node:assert/strict";
import test from "node:test";
import { connectionAddress } from "./connection-address";

test("formats the server IP and first game port without a URL scheme", () => {
    assert.equal(connectionAddress("203.0.113.10", [7210, 7211]), "203.0.113.10:7210");
    assert.equal(connectionAddress(" 203.0.113.10 ", [1]), "203.0.113.10:1");
    assert.equal(connectionAddress("203.0.113.10", [65535]), "203.0.113.10:65535");
});

test("brackets IPv6 without double brackets", () => {
    assert.equal(connectionAddress("2001:db8::1", [7210]), "[2001:db8::1]:7210");
    assert.equal(connectionAddress("[2001:db8::1]", [7210]), "[2001:db8::1]:7210");
});

test("does not invent missing addresses or ports", () => {
    for (const ip of [null, "", " ", "https://203.0.113.10", "203.0.113.10 extra"]) {
        assert.equal(connectionAddress(ip, [7210]), null);
    }
    for (const ports of [[], [0], [-1], [65536], [1.5], [NaN], [Infinity]]) {
        assert.equal(connectionAddress("203.0.113.10", ports), null);
    }
});
