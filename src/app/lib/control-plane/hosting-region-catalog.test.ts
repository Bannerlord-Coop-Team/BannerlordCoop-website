import assert from "node:assert/strict";
import test from "node:test";
import { ControlPlaneAdminError } from "./client";
import {
    parseHostingRegionCatalog,
    readHostingRegionCatalog,
} from "./hosting-region-catalog";
import { hostingRegionCatalogPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const seed = () => hostingRegionCatalogPayload().map((entry) => ({ ...entry, available: true }));

test("a catalog's revision and audit fields are ignored, so they cannot make the entries unreadable", () => {
    assert.deepEqual(parseHostingRegionCatalog({ regions: seed(), revision: 4, updatedAt: 1, updatedBy: "x".repeat(300) }), seed());
});

test("malformed stored catalogs are rejected", () => {
    const entry = { region: "france", placement: { countryCodes: ["FR"] }, available: false };
    for (const regions of [undefined, null, [],
        Array.from({ length: 33 }, (_, index) => ({ ...entry, region: `region-${index}` })),
        [entry, entry], [{ ...entry, region: "France" }],
        [{ ...entry, label: "France" }], [{ ...entry, placement: { countryCodes: ["fr"] } }],
        [{ ...entry, placement: { countryCodes: [] } }], [{ ...entry, placement: { countryCodes: ["FR", "FR"] } }],
        [{ ...entry, placement: { countryCodes: ["FR"], locationIds: [] } }],
        [{ ...entry, placement: { countryCodes: ["FR"], hosts: ["x"] } }],
        [{ region: "france", placement: { countryCodes: ["FR"] } }],
        [{ ...entry, available: "true" }]]) {
        assert.throws(() => parseHostingRegionCatalog({ regions }), ControlPlaneAdminError, JSON.stringify(regions));
    }
    assert.throws(() => parseHostingRegionCatalog(null), ControlPlaneAdminError);
    assert.throws(() => parseHostingRegionCatalog([]), ControlPlaneAdminError);
});

test("reading the stored catalog degrades to a message instead of failing Operations", async () => {
    assert.deepEqual(await readHostingRegionCatalog(async () => ({ regions: seed() })), { regions: seed(), error: null });
    const unsupported = await readHostingRegionCatalog(async () => { throw new ControlPlaneAdminError("unsupported_operation", "Unsupported."); });
    assert.deepEqual(unsupported, { regions: null, error: "Unsupported." });
    const malformed = await readHostingRegionCatalog(async () => ({ revision: 1 }));
    assert.deepEqual(malformed, { regions: null, error: "The control plane returned an invalid hosting-region catalog." });
});
