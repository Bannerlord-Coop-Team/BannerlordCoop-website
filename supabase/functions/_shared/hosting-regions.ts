// The website's hosting-region catalog: keys, English labels, continent grouping and placements.
// The control plane matches hosts against its own stored copy of these placements; an administrator
// publishes this catalog to it from the Operations page (`set-hosting-regions`). Owners only send keys.

/** Continent tabs, in display order. */
export const HOSTING_CONTINENTS = ["north-america", "europe", "south-america", "asia", "oceania"] as const;
export type HostingContinent = typeof HOSTING_CONTINENTS[number];

/** Hosts eligible for a region: a country allowlist, optionally narrowed to exact provider zones. */
type HostingPlacement = {
    readonly countryCodes: readonly string[];
    readonly locationIds?: readonly string[];
};

/** One website catalog entry: its key, English label, continent tab and placement. */
export type HostingRegionDefinition = {
    readonly key: string;
    readonly label: string;
    readonly continent: HostingContinent;
    readonly placement: HostingPlacement;
};

/** A JSON-safe catalog entry in the control plane's wire form; the one wire type for definitions and placements. */
export type HostingRegionPayload = { region: string; placement: { countryCodes: string[]; locationIds?: string[] } };

// The control plane's catalog bounds, shared by every parser and test of a catalog or summary.
/** Most regions a stored catalog (and so an owner summary) may hold. */
export const MAXIMUM_REGIONS = 32;
/** Most countries one placement may name. */
export const MAXIMUM_PLACEMENT_COUNTRIES = 64;
/** Most provider zones one placement may name. */
export const MAXIMUM_PLACEMENT_LOCATIONS = 32;
/** An upper-case ISO 3166-1 alpha-2 country code. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u;
/** A provider zone identifier. */
export const LOCATION_ID_PATTERN = /^[A-Za-z\d][A-Za-z\d._:-]{0,127}$/u;
// Region keys the control plane accepts: bounded lowercase slugs.
const REGION_KEY_PATTERN = /^[a-z][a-z0-9-]{1,47}$/u;

// Coast regions name their exact zones: a US country code alone never implies a coast.
export const HOSTING_REGIONS = [
    { key: "us-west", label: "US-West", continent: "north-america",
        placement: { countryCodes: ["US"], locationIds: ["os-us-west-or-2", "us-west-or"] } },
    { key: "us-east", label: "US-East", continent: "north-america",
        placement: { countryCodes: ["US"], locationIds: ["os-us-east-va-2", "us-east-va"] } },
    { key: "france", label: "France", continent: "europe", placement: { countryCodes: ["FR"] } },
    { key: "germany", label: "Germany", continent: "europe", placement: { countryCodes: ["DE"] } },
    { key: "united-kingdom", label: "United Kingdom", continent: "europe", placement: { countryCodes: ["GB"] } },
    { key: "poland", label: "Poland", continent: "europe", placement: { countryCodes: ["PL"] } },
    // No hosts here yet: these stay full, so owners can only request them to register demand.
    { key: "singapore", label: "Singapore", continent: "asia", placement: { countryCodes: ["SG"] } },
    { key: "japan", label: "Japan", continent: "asia", placement: { countryCodes: ["JP"] } },
    { key: "south-korea", label: "South Korea", continent: "asia", placement: { countryCodes: ["KR"] } },
    { key: "australia", label: "Australia (Sydney)", continent: "oceania", placement: { countryCodes: ["AU"] } },
] as const satisfies readonly HostingRegionDefinition[];

type HostingRegionKey = typeof HOSTING_REGIONS[number]["key"];

/** Whether a value is a key in this website catalog. */
export function isHostingRegionKey(value: unknown): value is HostingRegionKey {
    return HOSTING_REGIONS.some((region) => region.key === value);
}

/** Whether a value has the shape of any region key, including keys this catalog does not know. */
export function isRegionKey(value: unknown): value is string {
    return typeof value === "string" && REGION_KEY_PATTERN.test(value);
}

/** English display label for any region key: the catalog label, else the key humanized ("united-states" -> "United States"). */
export function hostingRegionLabel(key: string): string {
    const region = HOSTING_REGIONS.find((entry) => entry.key === key);
    if (region !== undefined) return region.label;
    return key.split("-").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** The whole catalog in the control plane's wire form, in display order, as an independent copy. */
export function hostingRegionCatalogPayload(): HostingRegionPayload[] {
    return HOSTING_REGIONS.map((region) => ({ region: region.key, placement: placementPayload(region.placement) }));
}

/** Whether a value is a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an object has exactly the expected own keys. */
export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

/** Copies a readonly placement into mutable JSON arrays. */
function placementPayload(placement: HostingPlacement): HostingRegionPayload["placement"] {
    if (placement.locationIds === undefined) return { countryCodes: [...placement.countryCodes] };
    return { countryCodes: [...placement.countryCodes], locationIds: [...placement.locationIds] };
}
