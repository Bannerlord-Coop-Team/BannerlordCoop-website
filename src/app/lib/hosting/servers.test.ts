import assert from "node:assert/strict";
import test from "node:test";
import { getServerForRole, getServersForRole, PLACEHOLDER_SERVERS } from "./servers";

test("fleet roles can see every placeholder server", () => {
    assert.equal(getServersForRole("Admin").length, PLACEHOLDER_SERVERS.length);
    assert.equal(getServersForRole("Server Manager").length, PLACEHOLDER_SERVERS.length);
});

test("subscriber roles only see their own plan placeholder", () => {
    assert.deepEqual(
        getServersForRole("Standard Server").map((server) => server.plan),
        ["Standard"],
    );
    assert.deepEqual(
        getServersForRole("Premium Server").map((server) => server.plan),
        ["Premium"],
    );
    assert.deepEqual(getServersForRole("User"), []);
});

test("individual server lookup enforces role visibility", () => {
    assert.equal(
        getServerForRole("calradia-standard-01", "Standard Server")?.plan,
        "Standard",
    );
    assert.equal(
        getServerForRole("vlandian-premium-01", "Standard Server"),
        undefined,
    );
    assert.equal(
        getServerForRole("vlandian-premium-01", "Server Manager")?.plan,
        "Premium",
    );
});
