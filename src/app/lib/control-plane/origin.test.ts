import assert from "node:assert/strict";
import test from "node:test";
import { ControlPlaneOriginError, controlPlaneEndpoint, controlPlaneOrigin, DEFAULT_CONTROL_PLANE_ORIGIN } from "./origin";
import { listPublicServers } from "../hosting/public-servers";

test("unset or empty CONTROL_PLANE_ORIGIN keeps the exact production origin", () => {
    assert.equal(DEFAULT_CONTROL_PLANE_ORIGIN, "https://control-plane.bannerlordcoop.com");
    assert.equal(controlPlaneOrigin(undefined), "https://control-plane.bannerlordcoop.com");
    assert.equal(controlPlaneOrigin(""), "https://control-plane.bannerlordcoop.com");
    assert.equal(controlPlaneEndpoint("/v1/admin/control-plane", ""), "https://control-plane.bannerlordcoop.com/v1/admin/control-plane");
});

test("a bare HTTPS origin override is accepted and normalized", () => {
    assert.equal(controlPlaneOrigin("https://control-plane.example.com"), "https://control-plane.example.com");
    assert.equal(controlPlaneOrigin("https://Control-Plane.Example.com/"), "https://control-plane.example.com");
    assert.equal(controlPlaneOrigin("https://localhost:9443"), "https://localhost:9443");
    assert.equal(controlPlaneOrigin("https://127.0.0.1:9443"), "https://127.0.0.1:9443");
    assert.equal(controlPlaneEndpoint("/v1/user/control-plane", "https://localhost:9443"), "https://localhost:9443/v1/user/control-plane");
});

test("invalid overrides fail closed", () => {
    for (const value of [
        "control-plane.example.com", "http://control-plane.example.com", "http://localhost:9443", "wss://control-plane.example.com",
        "https://user:pass@control-plane.example.com", "https://user@control-plane.example.com", "https://control-plane.example.com/v1",
        "https://control-plane.example.com/?x=1", "https://control-plane.example.com/?", "https://control-plane.example.com/#a",
        "https://control-plane.example.com#", " https://control-plane.example.com", "https://control-plane.example.com\n", " ", "https://",
    ]) {
        assert.throws(() => controlPlaneOrigin(value), ControlPlaneOriginError, value);
    }
});

test("loopback HTTP is accepted only under next dev; non-loopback HTTP never", () => {
    assert.equal(controlPlaneOrigin("http://127.0.0.1:8796", "development"), "http://127.0.0.1:8796");
    assert.equal(controlPlaneOrigin("http://localhost:8796/", "development"), "http://localhost:8796");
    assert.equal(controlPlaneOrigin("http://[::1]:8796", "development"), "http://[::1]:8796");
    for (const nodeEnv of ["production", "test", undefined]) {
        assert.throws(() => controlPlaneOrigin("http://127.0.0.1:8796", nodeEnv), ControlPlaneOriginError, String(nodeEnv));
    }
    for (const value of ["http://control-plane.example.com", "http://192.168.1.10:8796", "http://localhost.:8796",
        "http://127.0.0.1:8796/v1", "http://user@127.0.0.1:8796", "http://127.0.0.1:8796/?x=1"]) {
        assert.throws(() => controlPlaneOrigin(value, "development"), ControlPlaneOriginError, value);
    }
});

test("the public loader uses the override and sends no request when it is invalid", async () => {
    const original = process.env.CONTROL_PLANE_ORIGIN;
    try {
        process.env.CONTROL_PLANE_ORIGIN = "https://localhost:9443";
        const seen: string[] = [];
        await listPublicServers(async (url) => {
            seen.push(String(url));
            return new Response(null, { status: 503 });
        }).catch(() => undefined);
        assert.deepEqual(seen, ["https://localhost:9443/v1/public/control-plane"]);

        process.env.CONTROL_PLANE_ORIGIN = "http://control-plane.example.com";
        let calls = 0;
        await assert.rejects(listPublicServers(async () => { calls++; return new Response(null, { status: 500 }); }), ControlPlaneOriginError);
        assert.equal(calls, 0);
    } finally {
        if (original === undefined) delete process.env.CONTROL_PLANE_ORIGIN;
        else process.env.CONTROL_PLANE_ORIGIN = original;
    }
});
