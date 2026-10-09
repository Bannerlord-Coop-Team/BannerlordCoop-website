import assert from "node:assert/strict";
import test from "node:test";
import servers from "../localization/dictionaries/en/servers.json";
import { createTranslator } from "../localization/translator";
import { localizedContinentLabel, localizedRegionLabel } from "./region-labels";
import { HOSTING_CONTINENTS, HOSTING_REGIONS } from "../../../../supabase/functions/_shared/hosting-regions";

const english: Record<string, unknown> = servers;
const { t } = createTranslator("en", servers);

// Dictionary parity (runtime.component.test.tsx) then carries every key below to the other locales.
test("every website region and continent has an English servers translation", () => {
    for (const region of HOSTING_REGIONS) assert.ok(Object.hasOwn(english, `region.${region.key}`), `region.${region.key}`);
    for (const continent of HOSTING_CONTINENTS) assert.ok(Object.hasOwn(english, `continent.${continent}`), `continent.${continent}`);
});

test("region labels translate catalog keys and fall back to a readable label for any other key", () => {
    assert.equal(localizedRegionLabel(t, "united-kingdom"), english["region.united-kingdom"]);
    assert.equal(localizedRegionLabel(t, "united-states"), "United States");
    assert.equal(localizedRegionLabel(t, "europe-automatic"), "Europe Automatic");
    assert.equal(localizedRegionLabel(t, "japan"), "Japan");
    assert.equal(localizedContinentLabel(t, "oceania"), english["continent.oceania"]);
});
