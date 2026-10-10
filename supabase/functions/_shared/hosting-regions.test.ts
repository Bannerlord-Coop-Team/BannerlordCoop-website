import assert from "node:assert/strict";
import test from "node:test";
import {
    COUNTRY_CODE_PATTERN,
    HOSTING_CONTINENTS,
    HOSTING_REGIONS,
    LOCATION_ID_PATTERN,
    MAXIMUM_PLACEMENT_COUNTRIES,
    MAXIMUM_PLACEMENT_LOCATIONS,
    MAXIMUM_REGIONS,
    hostingRegionCatalogPayload,
    hostingRegionLabel,
    isRegionKey,
    isWebsiteRegionKey,
} from "./hosting-regions.ts";

test("every website region is a valid, unique control-plane definition on a known continent", () => {
    const keys = HOSTING_REGIONS.map((region) => region.key);
    assert.equal(new Set(keys).size, keys.length);
    // The control plane's own bounds; a catalog outside them would be rejected when published.
    assert.ok(HOSTING_REGIONS.length >= 1 && HOSTING_REGIONS.length <= MAXIMUM_REGIONS);
    for (const region of HOSTING_REGIONS) {
        assert.ok(isRegionKey(region.key), region.key);
        assert.ok(region.label.length > 0);
        assert.ok(HOSTING_CONTINENTS.includes(region.continent), region.key);
        const { countryCodes } = region.placement;
        const locationIds: readonly string[] | undefined = "locationIds" in region.placement ? region.placement.locationIds : undefined;
        assert.ok(countryCodes.length >= 1 && countryCodes.length <= MAXIMUM_PLACEMENT_COUNTRIES && new Set(countryCodes).size === countryCodes.length, region.key);
        for (const country of countryCodes) assert.match(country, COUNTRY_CODE_PATTERN);
        if (locationIds !== undefined) {
            assert.ok(locationIds.length >= 1 && locationIds.length <= MAXIMUM_PLACEMENT_LOCATIONS && new Set(locationIds).size === locationIds.length, region.key);
            for (const location of locationIds) assert.match(location, LOCATION_ID_PATTERN);
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

test("website region keys are only the keys this catalog defines, not every well-formed key", () => {
    for (const region of HOSTING_REGIONS) assert.equal(isWebsiteRegionKey(region.key), true, region.key);
    for (const key of ["japan", "united-states", "US-West", null]) assert.equal(isWebsiteRegionKey(key), false, String(key));
});
