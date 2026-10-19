import assert from "node:assert/strict";
import test from "node:test";
import { isIP } from "node:net";
import { connectionAddress, isJoinAddress } from "./connection-address";

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

test("accepts only real IPv4 or bracketed IPv6 join addresses with a valid port", () => {
    for (const address of ["203.0.113.10:4201", "0.0.0.0:1", "255.255.255.255:65535", "[2001:db8::1]:4201", "[::1]:7210",
        "[::]:7210", "[1:2:3:4:5:6:7:8]:7210", "[1:2:3:4:5:6:7::]:7210", "[::2:3:4:5:6:7:8]:7210", "[::ffff:203.0.113.10]:7210", "[2001:DB8::A]:7210"]) {
        assert.equal(isJoinAddress(address), true, address);
    }
    for (const address of ["999.999.999.999:0", "1.2.3.4:70000", "1.2.3.4:0", "[zz::1]:7210", "256.1.1.1:7210", "01.2.3.4:7210",
        "1.2.3:7210", "1.2.3.4", "2001:db8::1:7210", "[2001:db8::1]", "[1:2:3:4:5:6:7:8:9]:7210", "[1:2:3:4:5:6:7]:7210",
        "[1::2::3]:7210", "[:1::]:7210", "[1:2:3:4:5:6:7:8::]:7210", "[12345::1]:7210", "[::1.2.3.256]:7210", "[1.2.3.4]:7210",
        "[::1%eth0]:7210", "play.example.com:7210", " 1.2.3.4:7210", 4201, null]) {
        assert.equal(isJoinAddress(address), false, String(address));
    }
});

test("agrees with Node's IP parser on which hosts are addresses", () => {
    const hosts = ["203.0.113.10", "0.0.0.0", "255.255.255.255", "256.0.0.1", "01.2.3.4", "1.2.3", "1.2.3.4.5", "::", "::1",
        "2001:db8::1", "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7::", "::2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "1::2::3",
        ":1::", "1:2:3:4:5:6:7:8::", "12345::1", "::ffff:1.2.3.4", "::ffff:1.2.3.256", "1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6:7:1.2.3.4",
        "::1.2.3.4", "fe80::1:2", "zz::1", "1.2.3.4::"];
    for (const host of hosts) {
        const address = host.includes(":") ? `[${host}]:7210` : `${host}:7210`;
        assert.equal(isJoinAddress(address), isIP(host) !== 0, host);
    }
});
