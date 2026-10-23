import assert from "node:assert/strict";
import test from "node:test";
import {
    buildManualVpsInput,
    emptyManualVpsForm,
    manualEntryProviders,
    manualVpsCountryChoices,
    manualVpsExamples,
    manualVpsLocationChoices,
    manualVpsLoginAddress,
    manualVpsRegion,
    manualVpsSlotCount,
    selectManualVpsRegion,
    validateManualVpsForm,
    type ManualVpsFormValues,
} from "./manual-vps";
import type { HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const REGIONS: HostingRegionPayload[] = [
    { region: "benelux", placement: { countryCodes: ["NL", "BE"] } },
    { region: "france", placement: { countryCodes: ["FR"] } },
    { region: "us-east", placement: { countryCodes: ["US"], locationIds: ["us-east-va", "os-us-east-va-2"] } },
    { region: "us-west", placement: { countryCodes: ["US"], locationIds: ["us-west-or"] } },
];
const PROVIDERS = [{ provider: "hosthatch-vps", displayName: "HostHatch VPS" }];
const CHOICES = { providers: PROVIDERS, regions: REGIONS };

/** A complete, valid form whose fields individual tests override. */
function form(overrides: Partial<ManualVpsFormValues> = {}): ManualVpsFormValues {
    return {
        provider: "hosthatch-vps", serviceName: "hosthatch-ams-1", sshLogin: "root@45.91.20.7",
        vCpu: "8", region: "benelux", countryCode: "NL", locationId: "ams", publicHostname: "", datacenter: "", ...overrides,
    };
}

/** The per-field error a form produces, or undefined when that field is valid. */
function fieldError(values: ManualVpsFormValues, field: keyof ManualVpsFormValues) {
    const result = validateManualVpsForm(values, CHOICES);
    return result.ok ? undefined : result.errors[field];
}

test("a missing or malformed manualEntryProviders list from an older backend yields no provider", () => {
    assert.deepEqual(manualEntryProviders({ hosts: [], availableHosts: [] }), []);
    assert.deepEqual(manualEntryProviders(null), []);
    assert.deepEqual(manualEntryProviders({ manualEntryProviders: "hosthatch-vps" }), []);
    assert.deepEqual(manualEntryProviders({ manualEntryProviders: [] }), []);
});

test("manual-entry providers keep only well-formed, unique entries in their closed shape", () => {
    assert.deepEqual(manualEntryProviders({ manualEntryProviders: [
        { provider: "hosthatch-vps", displayName: "HostHatch VPS", extra: true },
        { provider: "hosthatch-vps", displayName: "Duplicate" },
        { provider: "Bad Id", displayName: "Bad" },
        { provider: "ok-provider", displayName: "" },
        { provider: "other-vps", displayName: "Line\nbreak" },
        { provider: "other-vps" },
        "hosthatch-vps",
    ] }), [{ provider: "hosthatch-vps", displayName: "HostHatch VPS" }]);
});

test("the provider is preselected only when there is exactly one", () => {
    assert.equal(emptyManualVpsForm(PROVIDERS).provider, "hosthatch-vps");
    assert.equal(emptyManualVpsForm([]).provider, "");
    assert.equal(emptyManualVpsForm([...PROVIDERS, { provider: "other-vps", displayName: "Other" }]).provider, "");
});

test("a region narrows country and location choices, defaulting each only when it has one choice", () => {
    assert.deepEqual(manualVpsCountryChoices(undefined), []);
    assert.deepEqual(manualVpsCountryChoices(manualVpsRegion(REGIONS, "benelux")), ["NL", "BE"]);
    assert.equal(manualVpsLocationChoices(manualVpsRegion(REGIONS, "benelux")), null);
    assert.deepEqual(manualVpsLocationChoices(manualVpsRegion(REGIONS, "us-east")), ["us-east-va", "os-us-east-va-2"]);

    const benelux = selectManualVpsRegion(form({ countryCode: "FR", locationId: "par" }), REGIONS, "benelux");
    assert.deepEqual([benelux.region, benelux.countryCode, benelux.locationId], ["benelux", "", ""]);
    const france = selectManualVpsRegion(benelux, REGIONS, "france");
    assert.deepEqual([france.countryCode, france.locationId], ["FR", ""]);
    const usWest = selectManualVpsRegion(france, REGIONS, "us-west");
    assert.deepEqual([usWest.countryCode, usWest.locationId], ["US", "us-west-or"]);
    const usEast = selectManualVpsRegion(usWest, REGIONS, "us-east");
    assert.deepEqual([usEast.countryCode, usEast.locationId], ["US", ""]);
    assert.equal(usEast.serviceName, "hosthatch-ams-1");
});

test("placeholder facts follow the chosen provider and stay neutral without one of their own", () => {
    assert.deepEqual(manualVpsExamples("hosthatch-vps"), { serviceName: "hosthatch-ams-1", locationId: "ams", datacenter: "Amsterdam" });
    assert.deepEqual(manualVpsExamples("vpstc-vps"), { serviceName: "vpstc-ist-1", locationId: "ist", datacenter: "Istanbul" });
    for (const provider of ["", "ovhcloud-vps", "future-vps"]) {
        assert.deepEqual(manualVpsExamples(provider), { serviceName: "vps-ams-1", locationId: "ams", datacenter: "Amsterdam" }, provider);
    }
});

test("the slot count is one per two vCPUs within 2–64 whole vCPUs", () => {
    assert.equal(manualVpsSlotCount("2"), 1);
    assert.equal(manualVpsSlotCount(" 7 "), 3);
    assert.equal(manualVpsSlotCount("64"), 32);
    for (const invalid of ["", "1", "65", "2.5", "-4", "1e1", "abc"]) assert.equal(manualVpsSlotCount(invalid), null, invalid);
});

test("a valid form becomes the exact strict input, with blank optional fields sent as null and no host key", () => {
    const result = validateManualVpsForm(form({ serviceName: " hosthatch-ams-1 ", vCpu: " 8 " }), CHOICES);
    assert.deepEqual(result, { ok: true, input: {
        provider: "hosthatch-vps", serviceName: "hosthatch-ams-1", sshLogin: "root@45.91.20.7",
        vCpu: 8, region: "benelux", countryCode: "NL", locationId: "ams", publicHostname: null, datacenter: null,
    } });
    assert.deepEqual(Object.keys(buildManualVpsInput(form())), [
        "provider", "serviceName", "sshLogin", "vCpu", "region", "countryCode", "locationId", "publicHostname", "datacenter",
    ]);
});

test("filled optional fields and a region location dropdown are sent as entered", () => {
    const result = validateManualVpsForm(form({ region: "us-east", countryCode: "US", locationId: "os-us-east-va-2",
        publicHostname: "play.example.com", datacenter: "Ashburn (VA)" }), CHOICES);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.publicHostname, "play.example.com");
    assert.equal(result.input.datacenter, "Ashburn (VA)");
    assert.equal(result.input.locationId, "os-us-east-va-2");
});

test("the provider must be one the control plane listed", () => {
    assert.match(fieldError(form({ provider: "ovhcloud-vps" }), "provider") ?? "", /Choose a provider/u);
    assert.match(fieldError(form({ provider: "" }), "provider") ?? "", /Choose a provider/u);
});

test("the server name follows the permanent host-name grammar", () => {
    assert.equal(fieldError(form({ serviceName: "1234567" }), "serviceName"), undefined);
    assert.equal(fieldError(form({ serviceName: `a${"b".repeat(63)}` }), "serviceName"), undefined);
    for (const invalid of ["", "-host", ".host", "host_1", "host 1", `a${"b".repeat(64)}`, "host/../x"]) {
        assert.notEqual(fieldError(form({ serviceName: invalid }), "serviceName"), undefined, invalid);
    }
});

test("the SSH login is exactly root at a public IPv4 address", () => {
    assert.equal(fieldError(form({ sshLogin: "root@8.8.8.8" }), "sshLogin"), undefined);
    for (const invalid of ["debian@45.91.20.7", "45.91.20.7", "root@", "root@45.91.20", "root@45.91.20.256", "root@45.091.20.7",
        "root@host.example.com", "root@[2001:db8::1]", "root@10.0.0.4", "root@192.168.1.2", "root@172.16.0.1", "root@127.0.0.1",
        "root@100.64.0.1", "root@169.254.1.1", "root@0.1.2.3", "root@224.0.0.1", "root@203.0.113.10", "root@198.51.100.4",
        "root@192.0.2.1", "root@198.18.0.1", "root@192.88.99.1", "root@255.255.255.255", "ROOT@45.91.20.7"]) {
        assert.notEqual(fieldError(form({ sshLogin: invalid }), "sshLogin"), undefined, invalid);
    }
    assert.equal(manualVpsLoginAddress(" root@45.91.20.7 "), "45.91.20.7");
    assert.equal(manualVpsLoginAddress("admin@45.91.20.7"), null);
});

test("vCPU must be a whole number from 2 to 64", () => {
    for (const invalid of ["", "1", "65", "4.5", "four"]) assert.notEqual(fieldError(form({ vCpu: invalid }), "vCpu"), undefined, invalid);
});

test("region, country and location must agree with the catalog", () => {
    assert.match(fieldError(form({ region: "atlantis" }), "region") ?? "", /catalog/u);
    assert.match(fieldError(form({ region: "" }), "countryCode") ?? "", /region first/u);
    assert.match(fieldError(form({ countryCode: "FR" }), "countryCode") ?? "", /region's countries/u);
    assert.match(fieldError(form({ countryCode: "nl" }), "countryCode") ?? "", /region's countries/u);
    assert.match(fieldError(form({ region: "us-east", countryCode: "US", locationId: "ams" }), "locationId") ?? "", /region's locations/u);
    for (const invalid of ["", "-ams", "a m s", "x".repeat(129)]) {
        assert.notEqual(fieldError(form({ locationId: invalid }), "locationId"), undefined, invalid);
    }
    assert.equal(fieldError(form({ locationId: "nl-ams_1:a" }), "locationId"), undefined);
});

test("the player hostname is blank or a DNS name, and the datacenter blank or a short label", () => {
    for (const valid of ["", "play.example.com", "a-1.b.example"]) assert.equal(fieldError(form({ publicHostname: valid }), "publicHostname"), undefined, valid);
    for (const invalid of ["localhost", "45.91.20.7", "play.example.com.", "-a.example.com", "a..example.com", "play_1.example.com", `${"a".repeat(64)}.com`]) {
        assert.notEqual(fieldError(form({ publicHostname: invalid }), "publicHostname"), undefined, invalid);
    }
    for (const valid of ["", "Amsterdam", "NL-AMS (1)"]) assert.equal(fieldError(form({ datacenter: valid }), "datacenter"), undefined, valid);
    for (const invalid of ["-AMS", "x".repeat(65), "Ams\nterdam", "Amsterdam!"]) {
        assert.notEqual(fieldError(form({ datacenter: invalid }), "datacenter"), undefined, invalid);
    }
});
