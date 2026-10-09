import assert from "node:assert/strict";
import test from "node:test";
import { ControlPlaneAdminError } from "./client";
import {
    compareHostingRegionCatalogs,
    formatPlacement,
    hasHostingRegionDrift,
    parseHostingRegionCatalog,
    readHostingRegionCatalog,
} from "./hosting-region-catalog";
import { hostingRegionCatalogPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const seed = () => ({ revision: 1, regions: hostingRegionCatalogPayload(), updatedAt: null, updatedBy: null });

test("a stored catalog equal to the website catalog has no drift", () => {
    const drift = compareHostingRegionCatalogs(parseHostingRegionCatalog(seed()).regions, hostingRegionCatalogPayload());
    assert.deepEqual(drift, { missing: [], extra: [], placementDiffers: [], orderDiffers: false });
    assert.equal(hasHostingRegionDrift(drift), false);
});

test("drift reports missing, extra, placement and order differences independently", () => {
    const website = hostingRegionCatalogPayload();
    const stored = website.filter((entry) => entry.region !== "poland").reverse()
        .map((entry) => entry.region === "france" ? { ...entry, placement: { countryCodes: ["FR", "BE"] } } : entry);
    stored.push({ region: "japan", placement: { countryCodes: ["JP"] } });
    const drift = compareHostingRegionCatalogs(stored, website);
    assert.deepEqual(drift, { missing: ["poland"], extra: ["japan"], placementDiffers: ["france"], orderDiffers: true });
    assert.equal(hasHostingRegionDrift(drift), true);
});

test("placements compare as sets, and zones matter", () => {
    const website = [{ region: "us-west", placement: { countryCodes: ["US"], locationIds: ["a-1", "b-2"] } }];
    assert.deepEqual(compareHostingRegionCatalogs([{ region: "us-west", placement: { countryCodes: ["US"], locationIds: ["b-2", "a-1"] } }], website).placementDiffers, []);
    assert.deepEqual(compareHostingRegionCatalogs([{ region: "us-west", placement: { countryCodes: ["US"] } }], website).placementDiffers, ["us-west"]);
    assert.deepEqual(compareHostingRegionCatalogs([{ region: "us-west", placement: { countryCodes: ["US"], locationIds: ["a-1"] } }], website).placementDiffers, ["us-west"]);
    assert.equal(formatPlacement(website[0].placement), "US: a-1, b-2");
});

test("malformed stored catalogs are rejected", () => {
    const entry = { region: "france", placement: { countryCodes: ["FR"] } };
    for (const value of [null, [], { ...seed(), revision: -1 }, { ...seed(), revision: "1" }, { ...seed(), regions: [] },
        { ...seed(), regions: Array.from({ length: 33 }, (_, index) => ({ ...entry, region: `region-${index}` })) },
        { ...seed(), regions: [entry, entry] }, { ...seed(), regions: [{ ...entry, region: "France" }] },
        { ...seed(), regions: [{ ...entry, label: "France" }] }, { ...seed(), regions: [{ ...entry, placement: { countryCodes: ["fr"] } }] },
        { ...seed(), regions: [{ ...entry, placement: { countryCodes: [] } }] }, { ...seed(), regions: [{ ...entry, placement: { countryCodes: ["FR", "FR"] } }] },
        { ...seed(), regions: [{ ...entry, placement: { countryCodes: ["FR"], locationIds: [] } }] },
        { ...seed(), regions: [{ ...entry, placement: { countryCodes: ["FR"], hosts: ["x"] } }] },
        { ...seed(), updatedAt: 1 }]) {
        assert.throws(() => parseHostingRegionCatalog(value), ControlPlaneAdminError, JSON.stringify(value));
    }
});

test("reading the stored catalog degrades to a message instead of failing Operations", async () => {
    assert.deepEqual(await readHostingRegionCatalog(async () => seed()), { catalog: seed(), error: null });
    const unsupported = await readHostingRegionCatalog(async () => { throw new ControlPlaneAdminError("unsupported_operation", "Unsupported."); });
    assert.deepEqual(unsupported, { catalog: null, error: "Unsupported." });
    const malformed = await readHostingRegionCatalog(async () => ({ revision: 1 }));
    assert.deepEqual(malformed, { catalog: null, error: "The control plane returned an invalid hosting-region catalog." });
});
