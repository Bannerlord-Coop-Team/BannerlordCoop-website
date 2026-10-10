import assert from "node:assert/strict";
import test from "node:test";
import { ControlPlaneAdminError } from "./client";
import {
    parseHostingRegionCatalog,
    readHostingRegionCatalog,
} from "./hosting-region-catalog";
import { hostingRegionCatalogPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const seed = () => ({ regions: hostingRegionCatalogPayload().map((entry) => ({ ...entry, available: true })) });

test("a catalog's revision and audit fields are ignored, so they cannot make the entries unreadable", () => {
    assert.deepEqual(parseHostingRegionCatalog({ ...seed(), revision: 4, updatedAt: 1, updatedBy: "x".repeat(300) }), seed());
});

test("malformed stored catalogs are rejected", () => {
    const entry = { region: "france", placement: { countryCodes: ["FR"] }, available: false };
    for (const value of [null, [], {}, { regions: null }, { ...seed(), regions: [] },
        { ...seed(), regions: Array.from({ length: 33 }, (_, index) => ({ ...entry, region: `region-${index}` })) },
        { ...seed(), regions: [entry, entry] }, { ...seed(), regions: [{ ...entry, region: "France" }] },
        { ...seed(), regions: [{ ...entry, label: "France" }] }, { ...seed(), regions: [{ ...entry, placement: { countryCodes: ["fr"] } }] },
        { ...seed(), regions: [{ ...entry, placement: { countryCodes: [] } }] }, { ...seed(), regions: [{ ...entry, placement: { countryCodes: ["FR", "FR"] } }] },
        { ...seed(), regions: [{ ...entry, placement: { countryCodes: ["FR"], locationIds: [] } }] },
        { ...seed(), regions: [{ ...entry, placement: { countryCodes: ["FR"], hosts: ["x"] } }] },
        { ...seed(), regions: [{ region: "france", placement: { countryCodes: ["FR"] } }] },
        { ...seed(), regions: [{ ...entry, available: "true" }] }]) {
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
