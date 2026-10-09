// The website's hosting-region catalog: keys, English labels, continent grouping and placements.
// The control plane matches hosts against its own stored copy of these placements; an administrator
// publishes this catalog to it from the Operations page (`set-hosting-regions`). Owners only send keys.

/** Continent tabs, in display order. */
export const HOSTING_CONTINENTS = ["north-america", "europe", "south-america", "asia", "oceania"] as const;
export type HostingContinent = typeof HOSTING_CONTINENTS[number];

/** Hosts eligible for a region: a country allowlist, optionally narrowed to exact provider zones. */
export type HostingPlacement = {
    readonly countryCodes: readonly string[];
    readonly locationIds?: readonly string[];
};

export type HostingRegionDefinition = {
    readonly key: string;
    readonly label: string;
    readonly continent: HostingContinent;
    readonly placement: HostingPlacement;
};

/** A JSON-safe catalog entry in the control plane's wire form. */
export type HostingRegionPayload = { region: string; placement: { countryCodes: string[]; locationIds?: string[] } };

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
] as const satisfies readonly HostingRegionDefinition[];

export type HostingRegionKey = typeof HOSTING_REGIONS[number]["key"];

/** Region keys the control plane accepts: bounded lowercase slugs. */
export const REGION_KEY_PATTERN = /^[a-z][a-z0-9-]{1,47}$/u;

/** Whether a value is a key in this website catalog. */
export function isHostingRegionKey(value: unknown): value is HostingRegionKey {
    return HOSTING_REGIONS.some((region) => region.key === value);
}

/** Whether a value has the shape of any region key, including keys this catalog does not know. */
export function isRegionKey(value: unknown): value is string {
    return typeof value === "string" && REGION_KEY_PATTERN.test(value);
}

/** The catalog definition for a website region key. */
export function hostingRegion(key: HostingRegionKey): HostingRegionDefinition {
    return HOSTING_REGIONS.find((entry) => entry.key === key)!;
}

/** English display label for any region key: the catalog label, else the key humanized ("united-states" -> "United States"). */
export function hostingRegionLabel(key: string): string {
    if (isHostingRegionKey(key)) return hostingRegion(key).label;
    return key.split("-").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** The whole catalog in the control plane's wire form, in display order, as an independent copy. */
export function hostingRegionCatalogPayload(): HostingRegionPayload[] {
    return HOSTING_REGIONS.map((region) => ({ region: region.key, placement: placementPayload(region.placement) }));
}

/** Whether a host's provider country (and zone, when the placement names zones) satisfies a placement. */
export function placementMatchesHost(
    placement: HostingPlacement,
    host: { countryCode: string | null; locationId: string },
): boolean {
    if (host.countryCode === null || !placement.countryCodes.includes(host.countryCode)) return false;
    return placement.locationIds === undefined || placement.locationIds.includes(host.locationId);
}

/** Every website region a registered host serves, in catalog order. */
export function hostingRegionsForHost(host: { countryCode: string | null; locationId: string }): HostingRegionDefinition[] {
    return HOSTING_REGIONS.filter((region) => placementMatchesHost(region.placement, host));
}

/** Copies a readonly placement into mutable JSON arrays. */
function placementPayload(placement: HostingPlacement): HostingRegionPayload["placement"] {
    if (placement.locationIds === undefined) return { countryCodes: [...placement.countryCodes] };
    return { countryCodes: [...placement.countryCodes], locationIds: [...placement.locationIds] };
}
