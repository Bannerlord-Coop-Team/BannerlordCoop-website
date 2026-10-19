import assert from "node:assert/strict";
import test from "node:test";
import {
    hasServerDashboardAccess,
    hasServerFleetAccess,
    isMemberRole,
    isServerCustomerRole,
} from "./roles";

test("recognizes hosting roles", () => {
    assert.equal(isMemberRole("Server Manager"), true);
    assert.equal(isMemberRole("Standard Server"), true);
    assert.equal(isMemberRole("Premium Server"), true);
    assert.equal(isMemberRole("Owner"), false);
});

test("separates fleet and subscriber access", () => {
    assert.equal(hasServerFleetAccess("Admin"), true);
    assert.equal(hasServerFleetAccess("Server Manager"), true);
    assert.equal(hasServerFleetAccess("Premium Server"), false);

    assert.equal(isServerCustomerRole("Standard Server"), true);
    assert.equal(isServerCustomerRole("Premium Server"), true);
    assert.equal(isServerCustomerRole("Developer"), false);

    assert.equal(hasServerDashboardAccess("Admin"), true);
    assert.equal(hasServerDashboardAccess("Standard Server"), true);
    assert.equal(hasServerDashboardAccess("User"), false);
});
