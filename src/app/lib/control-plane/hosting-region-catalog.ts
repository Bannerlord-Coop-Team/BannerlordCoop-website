import { ControlPlaneAdminError } from "./client";
import type { HostingAdminRegionCatalog, HostingAdminRegionDefinition, HostingAdminRegionPlacement } from "./types";
import { isRegionKey, type HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const MAXIMUM_REGIONS = 32;
const MAXIMUM_COUNTRIES = 64;
const MAXIMUM_LOCATIONS = 32;
const COUNTRY = /^[A-Z]{2}$/u;
const LOCATION = /^[A-Za-z\d][A-Za-z\d._:-]{0,127}$/u;

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

/** Validates a `hosting-regions` result: revision, 0..32 unique well-formed keys with bounded placements, audit fields. */
export function parseHostingRegionCatalog(value: unknown): HostingAdminRegionCatalog {
    if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw invalidCatalog();
    if (!nullableText(value.updatedAt) || !nullableText(value.updatedBy)) throw invalidCatalog();
    // An empty catalog (revision 0) is a valid state the panel must still be able to publish over.
    if (!Array.isArray(value.regions) || value.regions.length > MAXIMUM_REGIONS) throw invalidCatalog();
    const regions = value.regions.map(parseDefinition);
    if (new Set(regions.map((entry) => entry.region)).size !== regions.length) throw invalidCatalog();
    return { revision: value.revision as number, regions, updatedAt: value.updatedAt, updatedBy: value.updatedBy };
}

/** Compares the stored catalog with the website catalog by key, placement (as sets) and the order of shared keys. */
export function compareHostingRegionCatalogs(
    stored: readonly HostingAdminRegionDefinition[],
    website: readonly HostingRegionPayload[],
): HostingRegionDrift {
    const storedKeys = stored.map((entry) => entry.region);
    const websiteKeys = website.map((entry) => entry.region);
    const shared = websiteKeys.filter((key) => storedKeys.includes(key));
    return {
        missing: websiteKeys.filter((key) => !storedKeys.includes(key)),
        extra: storedKeys.filter((key) => !websiteKeys.includes(key)),
        placementDiffers: shared.filter((key) => !samePlacement(
            stored.find((entry) => entry.region === key)!.placement, website.find((entry) => entry.region === key)!.placement)),
        orderDiffers: shared.join(",") !== storedKeys.filter((key) => websiteKeys.includes(key)).join(","),
    };
}

/** Whether a drift report shows any difference. */
export function hasHostingRegionDrift(drift: HostingRegionDrift): boolean {
    return drift.missing.length > 0 || drift.extra.length > 0 || drift.placementDiffers.length > 0 || drift.orderDiffers;
}

/** Describes a placement as "US: os-us-west-or-2, us-west-or" or "FR". */
export function formatPlacement(placement: HostingAdminRegionPlacement): string {
    const countries = placement.countryCodes.join(", ");
    if (placement.locationIds === undefined) return countries;
    return `${countries}: ${placement.locationIds.join(", ")}`;
}

/** Validates one stored entry. */
function parseDefinition(value: unknown): HostingAdminRegionDefinition {
    if (!isRecord(value) || !exactKeys(value, ["region", "placement"]) || !isRegionKey(value.region)) throw invalidCatalog();
    return { region: value.region, placement: parsePlacement(value.placement) };
}

/** Validates one placement: unique ISO countries and, when present, unique provider zones. */
function parsePlacement(value: unknown): HostingAdminRegionPlacement {
    if (!isRecord(value)) throw invalidCatalog();
    const hasLocations = Object.hasOwn(value, "locationIds");
    if (!exactKeys(value, hasLocations ? ["countryCodes", "locationIds"] : ["countryCodes"])) throw invalidCatalog();
    const countryCodes = uniqueList(value.countryCodes, COUNTRY, MAXIMUM_COUNTRIES);
    if (!hasLocations) return { countryCodes };
    return { countryCodes, locationIds: uniqueList(value.locationIds, LOCATION, MAXIMUM_LOCATIONS) };
}

/** Validates a non-empty bounded list of unique strings matching a pattern. */
function uniqueList(value: unknown, pattern: RegExp, maximum: number): string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw invalidCatalog();
    if (!value.every((item) => typeof item === "string" && pattern.test(item))) throw invalidCatalog();
    if (new Set(value).size !== value.length) throw invalidCatalog();
    return value as string[];
}

/** Whether two placements name the same countries and zones, ignoring order. */
function samePlacement(left: HostingAdminRegionPlacement, right: HostingAdminRegionPlacement): boolean {
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

/** Whether a value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an object has exactly the expected own keys. */
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

/** The error every rejected catalog raises. */
function invalidCatalog() {
    return new ControlPlaneAdminError("invalid_response", "The control plane returned an invalid hosting-region catalog.");
}
