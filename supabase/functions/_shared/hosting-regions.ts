// The website owns hosting regions: their keys, labels, grouping and placements.
// The control plane records only provider facts for each host (an ISO country and
// an exact zone) and matches hosts against the placement sent with each request.
// To offer a new region, add one entry here; no control-plane change is needed.

export type HostingContinent = "north-america" | "south-america" | "europe" | "asia" | "oceania";

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
export const HOSTING_REGION_KEYS: readonly HostingRegionKey[] = HOSTING_REGIONS.map((region) => region.key);

/** Region keys the control plane accepts: bounded lowercase slugs. */
export const REGION_KEY_PATTERN = /^[a-z][a-z0-9-]{1,47}$/u;

// Keys retained on older servers but no longer offered.
const RETIRED_REGION_LABELS: Readonly<Record<string, string>> = {
    "united-states": "United States",
    spain: "Spain",
    "europe-automatic": "Europe — Automatic",
};

export function isHostingRegionKey(value: unknown): value is HostingRegionKey {
    return HOSTING_REGION_KEYS.includes(value as HostingRegionKey);
}

export function hostingRegion(key: HostingRegionKey): HostingRegionDefinition {
    const region = HOSTING_REGIONS.find((entry) => entry.key === key);
    if (region === undefined) throw new Error("Unknown hosting region");
    return region;
}

/** Display label for any stored region key, including retired and unrecognized ones. */
export function hostingRegionLabel(key: string): string {
    return HOSTING_REGIONS.find((entry) => entry.key === key)?.label ?? RETIRED_REGION_LABELS[key] ?? key;
}

/** A JSON-safe copy of a region's placement for a control-plane request. */
export function placementPayload(placement: HostingPlacement): { countryCodes: string[]; locationIds?: string[] } {
    return {
        countryCodes: [...placement.countryCodes],
        ...(placement.locationIds === undefined ? {} : { locationIds: [...placement.locationIds] }),
    };
}

/** Every offered region with its placement, in display order, for the onboarding summary. */
export function regionDefinitionsPayload() {
    return HOSTING_REGIONS.map((region) => ({ region: region.key, placement: placementPayload(region.placement) }));
}

export function placementMatchesHost(
    placement: HostingPlacement,
    host: { countryCode: string | null; locationId: string },
): boolean {
    return host.countryCode !== null
        && placement.countryCodes.includes(host.countryCode)
        && (placement.locationIds === undefined || placement.locationIds.includes(host.locationId));
}

/** The first offered region a registered host serves, if any. */
export function hostingRegionForHost(host: { countryCode: string | null; locationId: string }): HostingRegionDefinition | null {
    return HOSTING_REGIONS.find((region) => placementMatchesHost(region.placement, host)) ?? null;
}
