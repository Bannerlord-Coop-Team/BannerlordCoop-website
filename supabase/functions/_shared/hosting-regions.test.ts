import assert from "node:assert/strict";
import test from "node:test";
import {
    HOSTING_CONTINENTS,
    HOSTING_REGIONS,
    REGION_KEY_PATTERN,
    hostingRegionCatalogPayload,
    hostingRegionLabel,
    isRegionKey,
} from "./hosting-regions.ts";

// The control plane's own bounds; a catalog outside them would be rejected when published.
const COUNTRY = /^[A-Z]{2}$/u;
const LOCATION = /^[A-Za-z\d][A-Za-z\d._:-]{0,127}$/u;

test("every website region is a valid, unique control-plane definition on a known continent", () => {
    const keys = HOSTING_REGIONS.map((region) => region.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(HOSTING_REGIONS.length >= 1 && HOSTING_REGIONS.length <= 32);
    for (const region of HOSTING_REGIONS) {
        assert.match(region.key, REGION_KEY_PATTERN);
        assert.ok(region.label.length > 0);
        assert.ok(HOSTING_CONTINENTS.includes(region.continent), region.key);
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

test("the published catalog carries every region and placement in website order, as a copy", () => {
    assert.deepEqual(hostingRegionCatalogPayload().map((entry) => entry.region), HOSTING_REGIONS.map((region) => region.key));
    const usWest = hostingRegionCatalogPayload().find((entry) => entry.region === "us-west");
    assert.deepEqual(usWest, { region: "us-west", placement: { countryCodes: ["US"], locationIds: ["os-us-west-or-2", "us-west-or"] } });
    assert.deepEqual(hostingRegionCatalogPayload().find((entry) => entry.region === "france"), { region: "france", placement: { countryCodes: ["FR"] } });
    // Mutating the payload never changes the catalog.
    usWest!.placement.countryCodes.push("CA");
    assert.deepEqual(hostingRegionCatalogPayload().find((entry) => entry.region === "us-west")!.placement.countryCodes, ["US"]);
});

test("labels cover website keys and humanize any other key", () => {
    assert.equal(hostingRegionLabel("united-kingdom"), "United Kingdom");
    assert.equal(hostingRegionLabel("us-west"), "US-West");
    assert.equal(hostingRegionLabel("united-states"), "United States");
    assert.equal(hostingRegionLabel("europe-automatic"), "Europe Automatic");
    assert.equal(hostingRegionLabel("atlantis"), "Atlantis");
});

test("region keys are bounded lowercase slugs", () => {
    for (const key of ["us-west", "japan", "a1", "x".repeat(48)]) assert.equal(isRegionKey(key), true, key);
    for (const key of ["US-West", "a", "1a", "-a", "a_b", "x".repeat(49), "", null, 1]) assert.equal(isRegionKey(key), false, String(key));
});
