import assert from "node:assert/strict";
import test from "node:test";
import type { HostingAdminVpsInventory } from "./types";
import { liveDataMismatchError, unlistedHostsError } from "./vps-readings";

test("a live-data mismatch names which way the response differs from the request", () => {
    assert.equal(liveDataMismatchError({ liveDataIncluded: true }, true), null);
    assert.equal(liveDataMismatchError({ liveDataIncluded: false }, false), null);
    assert.equal(liveDataMismatchError({ liveDataIncluded: false }, true), "Live VPS data is unavailable.");
    assert.equal(liveDataMismatchError({ liveDataIncluded: undefined }, true), "Live VPS data is unavailable.");
    assert.equal(liveDataMismatchError({ liveDataIncluded: true }, false), "The provider inventory read returned an unexpected live-data response.");
});

test("a provider-inventory response must list a host array", () => {
    assert.equal(unlistedHostsError({ availableHosts: [] }, true), null);
    assert.equal(unlistedHostsError({ availableHosts: "not-a-list" } as unknown as HostingAdminVpsInventory, false), null);
    assert.equal(unlistedHostsError({ availableHosts: "not-a-list" } as unknown as HostingAdminVpsInventory, true), "The provider account inventory response did not list hosts.");
});
