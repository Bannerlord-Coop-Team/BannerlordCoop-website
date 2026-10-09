import assert from "node:assert/strict";
import test from "node:test";
import {
    HOSTING_REGIONS,
    REGION_KEY_PATTERN,
    hostingRegionForHost,
    hostingRegionLabel,
    placementMatchesHost,
    regionDefinitionsPayload,
} from "./hosting-regions.ts";

// The control plane's own bounds; a catalog outside them would be rejected at the boundary.
const COUNTRY = /^[A-Z]{2}$/u;
const LOCATION = /^[A-Za-z\d][A-Za-z\d._:-]{0,127}$/u;

test("every offered region is a valid, unique control-plane definition", () => {
    const keys = HOSTING_REGIONS.map((region) => region.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(HOSTING_REGIONS.length >= 1 && HOSTING_REGIONS.length <= 32);
    for (const region of HOSTING_REGIONS) {
        assert.match(region.key, REGION_KEY_PATTERN);
        assert.ok(region.label.length > 0);
        const { countryCodes } = region.placement;
        const locationIds: readonly string[] | undefined = "locationIds" in region.placement ? region.placement.locationIds : undefined;
        assert.ok(countryCodes.length >= 1 && countryCodes.length <= 64 && new Set(countryCodes).size === countryCodes.length, region.key);
        for (const country of countryCodes) assert.match(country, COUNTRY);
        if (locationIds !== undefined) {
            assert.ok(locationIds.length >= 1 && locationIds.length <= 32 && new Set(locationIds).size === locationIds.length, region.key);
            for (const location of locationIds) assert.match(location, LOCATION);
        }
    }
});

test("the summary payload carries every offered region and placement in display order", () => {
    assert.deepEqual(regionDefinitionsPayload().map((entry) => entry.region), HOSTING_REGIONS.map((region) => region.key));
    assert.deepEqual(regionDefinitionsPayload()[0], {
        region: "us-west", placement: { countryCodes: ["US"], locationIds: ["os-us-west-or-2", "us-west-or"] },
    });
    // The payload is a copy: mutating it never changes the catalog.
    regionDefinitionsPayload()[0]!.placement.countryCodes.push("CA");
    assert.deepEqual(HOSTING_REGIONS[0].placement.countryCodes, ["US"]);
});

test("hosts match regions by provider country and exact zone, never by guess", () => {
    assert.equal(hostingRegionForHost({ countryCode: "PL", locationId: "os-waw2" })?.key, "poland");
    assert.equal(hostingRegionForHost({ countryCode: "US", locationId: "os-us-east-va-2" })?.key, "us-east");
    assert.equal(hostingRegionForHost({ countryCode: "US", locationId: "us-west-or" })?.key, "us-west");
    for (const host of [
        { countryCode: "US", locationId: "us-las" }, { countryCode: "US", locationId: "US-EAST-VA" },
        { countryCode: null, locationId: "os-waw2" }, { countryCode: "pl", locationId: "os-waw2" },
        { countryCode: "IT", locationId: "it-mil" },
    ]) assert.equal(hostingRegionForHost(host), null, JSON.stringify(host));
    assert.equal(placementMatchesHost({ countryCodes: ["PL", "CZ"] }, { countryCode: "CZ", locationId: "any" }), true);
});

test("labels cover offered, retired and unknown region keys", () => {
    assert.equal(hostingRegionLabel("united-kingdom"), "United Kingdom");
    assert.equal(hostingRegionLabel("united-states"), "United States");
    assert.equal(hostingRegionLabel("europe-automatic"), "Europe — Automatic");
    assert.equal(hostingRegionLabel("atlantis"), "atlantis");
});
