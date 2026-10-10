import { ControlPlaneAdminError } from "./client";
import type { HostingAdminRegionCatalog, HostingAdminRegionEntry } from "./types";
import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import {
    COUNTRY_CODE_PATTERN,
    isRegionKey,
    LOCATION_ID_PATTERN,
    MAXIMUM_PLACEMENT_COUNTRIES,
    MAXIMUM_PLACEMENT_LOCATIONS,
    MAXIMUM_REGIONS,
    type HostingRegionPlacementPayload,
} from "../../../../supabase/functions/_shared/hosting-regions";

/** Reads the stored catalog for the Operations page; a failure becomes a message instead of failing the page. */
export async function readHostingRegionCatalog(
    read: () => Promise<unknown>,
): Promise<{ catalog: HostingAdminRegionCatalog | null; error: string | null }> {
    try {
        return { catalog: parseHostingRegionCatalog(await read()), error: null };
    } catch (cause) {
        if (cause instanceof ControlPlaneAdminError) return { catalog: null, error: cause.message };
        return { catalog: null, error: "The control plane's hosting-region catalog could not be read." };
    }
}

/** Validates the `regions` of a `hosting-regions` result: 1..32 unique keys with bounded placements and availability. */
export function parseHostingRegionCatalog(value: unknown): HostingAdminRegionCatalog {
    // The website reads only the entries; the catalog's revision and audit fields are not validated so they cannot disable the views.
    if (!isRecord(value)) throw invalidCatalog();
    // The control plane never stores an empty catalog, so one is malformed.
    if (!Array.isArray(value.regions) || value.regions.length < 1 || value.regions.length > MAXIMUM_REGIONS) throw invalidCatalog();
    const regions = value.regions.map(parseDefinition);
    if (new Set(regions.map((entry) => entry.region)).size !== regions.length) throw invalidCatalog();
    return { regions };
}

/** Validates one stored entry: its key, placement and current availability. */
function parseDefinition(value: unknown): HostingAdminRegionEntry {
    if (!isRecord(value) || !hasExactKeys(value, ["region", "placement", "available"]) || !isRegionKey(value.region)) throw invalidCatalog();
    if (typeof value.available !== "boolean") throw invalidCatalog();
    return { region: value.region, placement: parsePlacement(value.placement), available: value.available };
}

/** Validates one placement: unique ISO countries and, when present, unique provider zones. */
function parsePlacement(value: unknown): HostingRegionPlacementPayload {
    if (!isRecord(value)) throw invalidCatalog();
    const hasLocations = Object.hasOwn(value, "locationIds");
    if (!hasExactKeys(value, hasLocations ? ["countryCodes", "locationIds"] : ["countryCodes"])) throw invalidCatalog();
    const countryCodes = uniqueList(value.countryCodes, COUNTRY_CODE_PATTERN, MAXIMUM_PLACEMENT_COUNTRIES);
    if (!hasLocations) return { countryCodes };
    return { countryCodes, locationIds: uniqueList(value.locationIds, LOCATION_ID_PATTERN, MAXIMUM_PLACEMENT_LOCATIONS) };
}

/** Validates a non-empty bounded list of unique strings matching a pattern. */
function uniqueList(value: unknown, pattern: RegExp, maximum: number): string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw invalidCatalog();
    if (!value.every((item) => typeof item === "string" && pattern.test(item))) throw invalidCatalog();
    if (new Set(value).size !== value.length) throw invalidCatalog();
    return value as string[];
}

/** The error every rejected catalog raises. */
function invalidCatalog() {
    return new ControlPlaneAdminError("invalid_response", "The control plane returned an invalid hosting-region catalog.");
}
