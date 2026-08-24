import assert from "node:assert/strict";
import test from "node:test";
import { assertContainerIdentityAndIsolation } from "./container-policy.mjs";

const server = {
    container: "bannerlord-one",
    dataPath: "/srv/data",
    dataVolume: "bannerlord-one-data",
    udpPort: 4200,
};

function inspection(overrides = {}) {
    return {
        Name: "/bannerlord-one",
        HostConfig: {
            PortBindings: {
                "4200/udp": [{ HostIp: "", HostPort: "4200" }],
            },
        },
        Mounts: [{
            Type: "volume",
            Name: "bannerlord-one-data",
            Destination: "/srv/data",
            RW: true,
        }],
        ...overrides,
    };
}

test("accepts the exact declared container identity and resources", () => {
    assert.doesNotThrow(() => assertContainerIdentityAndIsolation(inspection(), server));
});

test("rejects a container resolved through another name or Docker ID prefix", () => {
    assert.throws(
        () => assertContainerIdentityAndIsolation(
            inspection({ Name: "/bannerlord-two" }),
            server,
        ),
        /stable canonical name/,
    );
});

test("rejects another server's volume or UDP port", () => {
    assert.throws(
        () => assertContainerIdentityAndIsolation(inspection({
            Mounts: [{
                Type: "volume",
                Name: "bannerlord-two-data",
                Destination: "/srv/data",
                RW: true,
            }],
        }), server),
        /declared volume and UDP port/,
    );
    assert.throws(
        () => assertContainerIdentityAndIsolation(inspection({
            HostConfig: {
                PortBindings: {
                    "4201/udp": [{ HostIp: "", HostPort: "4201" }],
                },
            },
        }), server),
        /declared volume and UDP port/,
    );
});
