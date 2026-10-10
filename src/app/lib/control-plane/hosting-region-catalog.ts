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
    type HostingRegionPayload,
} from "../../../../supabase/functions/_shared/hosting-regions";

/** How the control plane's stored catalog differs from the website catalog; empty lists mean in sync. */
export type HostingRegionDrift = {
    missing: string[];
    extra: string[];
    placementDiffers: string[];
    orderDiffers: boolean;
};

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

/** Validates a `hosting-regions` result: revision >= 1, 1..32 unique keys with bounded placements and availability, audit fields. */
export function parseHostingRegionCatalog(value: unknown): HostingAdminRegionCatalog {
    if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) throw invalidCatalog();
    if (!nullableText(value.updatedAt) || !nullableText(value.updatedBy)) throw invalidCatalog();
    // The control plane seeds revision 1 and never stores an empty catalog, so either is malformed.
    if (!Array.isArray(value.regions) || value.regions.length < 1 || value.regions.length > MAXIMUM_REGIONS) throw invalidCatalog();
    const regions = value.regions.map(parseDefinition);
    if (new Set(regions.map((entry) => entry.region)).size !== regions.length) throw invalidCatalog();
    return { revision: value.revision as number, regions, updatedAt: value.updatedAt, updatedBy: value.updatedBy };
}

/** Compares the stored catalog with the website catalog by key, placement (as sets) and the order of shared keys. */
export function compareHostingRegionCatalogs(
    stored: readonly HostingRegionPayload[],
    website: readonly HostingRegionPayload[],
): HostingRegionDrift {
    const storedPlacements = new Map(stored.map((entry) => [entry.region, entry.placement]));
    const websitePlacements = new Map(website.map((entry) => [entry.region, entry.placement]));
    const placementDiffers: string[] = [];
    for (const [region, placement] of websitePlacements) {
        const storedPlacement = storedPlacements.get(region);
        if (storedPlacement !== undefined && !samePlacement(storedPlacement, placement)) placementDiffers.push(region);
    }
    const websiteOrder = [...websitePlacements.keys()].filter((key) => storedPlacements.has(key));
    const storedOrder = [...storedPlacements.keys()].filter((key) => websitePlacements.has(key));
    return {
        missing: [...websitePlacements.keys()].filter((key) => !storedPlacements.has(key)),
        extra: [...storedPlacements.keys()].filter((key) => !websitePlacements.has(key)),
        placementDiffers,
        orderDiffers: websiteOrder.join(",") !== storedOrder.join(","),
    };
}

/** Whether a drift report shows any difference. */
export function hasHostingRegionDrift(drift: HostingRegionDrift): boolean {
    return drift.missing.length > 0 || drift.extra.length > 0 || drift.placementDiffers.length > 0 || drift.orderDiffers;
}

/** Describes a placement as "US: os-us-west-or-2, us-west-or" or "FR". */
export function formatPlacement(placement: HostingRegionPayload["placement"]): string {
    const countries = placement.countryCodes.join(", ");
    if (placement.locationIds === undefined) return countries;
    return `${countries}: ${placement.locationIds.join(", ")}`;
}

/** Validates one stored entry: its key, placement and current availability. */
function parseDefinition(value: unknown): HostingAdminRegionEntry {
    if (!isRecord(value) || !hasExactKeys(value, ["region", "placement", "available"]) || !isRegionKey(value.region)) throw invalidCatalog();
    if (typeof value.available !== "boolean") throw invalidCatalog();
    return { region: value.region, placement: parsePlacement(value.placement), available: value.available };
}

/** Validates one placement: unique ISO countries and, when present, unique provider zones. */
function parsePlacement(value: unknown): HostingRegionPayload["placement"] {
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

/** Whether two placements name the same countries and zones, ignoring order. */
function samePlacement(left: HostingRegionPayload["placement"], right: HostingRegionPayload["placement"]): boolean {
    if (!sameSet(left.countryCodes, right.countryCodes)) return false;
    if (left.locationIds === undefined || right.locationIds === undefined) return left.locationIds === right.locationIds;
    return sameSet(left.locationIds, right.locationIds);
}

/** Whether two lists hold the same distinct values. */
function sameSet(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((item) => right.includes(item));
}

/** Whether a value is null or a bounded string. */
function nullableText(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && value.length <= 256);
}

/** The error every rejected catalog raises. */
function invalidCatalog() {
    return new ControlPlaneAdminError("invalid_response", "The control plane returned an invalid hosting-region catalog.");
}
