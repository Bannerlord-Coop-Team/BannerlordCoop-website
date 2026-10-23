import { isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import {
    COUNTRY_CODE_PATTERN,
    LOCATION_ID_PATTERN,
    type HostingRegionPayload,
} from "../../../../supabase/functions/_shared/hosting-regions";
import { isVpsProviderId, type VpsProviderId } from "./vps-providers";

/** The administrator operation that registers and onboards a VPS typed in by hand. */
export const MANUAL_VPS_OPERATION = "onboard-manual-vps-host";

/** One provider without an account API whose hosts the control plane accepts by manual entry. */
export type ManualEntryProvider = { provider: string; displayName: string };

/** The form's raw text values, one per input; everything is validated before it is sent. */
export type ManualVpsFormValues = {
    provider: string;
    serviceName: string;
    sshLogin: string;
    vCpu: string;
    region: string;
    countryCode: string;
    locationId: string;
    publicHostname: string;
    datacenter: string;
};

export type ManualVpsField = keyof ManualVpsFormValues;

/** The strict `onboard-manual-vps-host` input, in the control plane's wire form. */
export type ManualVpsInput = {
    provider: string;
    serviceName: string;
    sshLogin: string;
    vCpu: number;
    region: string;
    countryCode: string;
    locationId: string;
    publicHostname: string | null;
    datacenter: string | null;
};

/** The catalog-backed choices the form validates against. */
export type ManualVpsChoices = { providers: readonly ManualEntryProvider[]; regions: readonly HostingRegionPayload[] };

/** Placeholder host facts in one provider's own style, so the form's hints never name another vendor. */
export type ManualVpsExamples = { serviceName: string; locationId: string; datacenter: string };

export type ManualVpsValidation =
    | { ok: true; input: ManualVpsInput }
    | { ok: false; errors: Partial<Record<ManualVpsField, string>> };

export const MANUAL_VPS_MINIMUM_VCPU = 2;
export const MANUAL_VPS_MAXIMUM_VCPU = 64;
const SERVICE_NAME_PATTERN = /^[A-Za-z\d][A-Za-z\d.-]{0,63}$/u;
const PROVIDER_ID_PATTERN = /^[a-z][a-z\d-]{1,63}$/u;
const MAXIMUM_PROVIDERS = 16;
const MAXIMUM_PROVIDER_NAME_LENGTH = 64;
const MAXIMUM_HOSTNAME_LENGTH = 253;
const HOSTNAME_LABEL_PATTERN = /^[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
// The control plane's provider datacenter-name grammar; the label is audit evidence only.
const DATACENTER_PATTERN = /^[A-Za-z\d][A-Za-z\d ._:()-]{0,63}$/u;

// Keyed by provider id; a provider without its own, or no provider yet, shows the neutral example.
const MANUAL_VPS_EXAMPLES: Readonly<Partial<Record<VpsProviderId, ManualVpsExamples>>> = {
    "hosthatch-vps": { serviceName: "hosthatch-ams-1", locationId: "ams", datacenter: "Amsterdam" },
    "vpstc-vps": { serviceName: "vpstc-ist-1", locationId: "ist", datacenter: "Istanbul" },
};
const NEUTRAL_EXAMPLES: ManualVpsExamples = { serviceName: "vps-ams-1", locationId: "ams", datacenter: "Amsterdam" };

/** The placeholder facts for the chosen provider, or the neutral ones when it has none of its own. */
export function manualVpsExamples(provider: string): ManualVpsExamples {
    return (isVpsProviderId(provider) ? MANUAL_VPS_EXAMPLES[provider] : undefined) ?? NEUTRAL_EXAMPLES;
}

/** An empty form, with the provider preselected when there is exactly one. */
export function emptyManualVpsForm(providers: readonly ManualEntryProvider[]): ManualVpsFormValues {
    return {
        provider: providers.length === 1 ? providers[0]!.provider : "", serviceName: "", sshLogin: "",
        vCpu: "", region: "", countryCode: "", locationId: "", publicHostname: "", datacenter: "",
    };
}

/** Reads `manualEntryProviders` from a `vps-hosts` result; an older backend without it, or any malformed entry, yields no choice. */
export function manualEntryProviders(inventory: unknown): ManualEntryProvider[] {
    if (!isRecord(inventory) || !Array.isArray(inventory.manualEntryProviders)) return [];
    const providers = inventory.manualEntryProviders.slice(0, MAXIMUM_PROVIDERS).filter(isManualEntryProvider);
    return providers.filter((entry, index) => providers.findIndex((other) => other.provider === entry.provider) === index)
        .map(({ provider, displayName }) => ({ provider, displayName }));
}

/** Whether one untrusted list entry is a well-formed provider id with a bounded display name. */
function isManualEntryProvider(value: unknown): value is ManualEntryProvider {
    if (!isRecord(value) || typeof value.provider !== "string" || typeof value.displayName !== "string") return false;
    if (!PROVIDER_ID_PATTERN.test(value.provider)) return false;
    const name = value.displayName.trim();
    return name.length > 0 && name.length <= MAXIMUM_PROVIDER_NAME_LENGTH && !CONTROL_CHARACTERS.test(name);
}

/** Finds the catalog entry for a region key, or undefined when none is chosen or it is not in the catalog. */
export function manualVpsRegion(regions: readonly HostingRegionPayload[], key: string): HostingRegionPayload | undefined {
    return regions.find((entry) => entry.region === key);
}

/** The countries a host in the region may report; none until a region is chosen. */
export function manualVpsCountryChoices(region: HostingRegionPayload | undefined): readonly string[] {
    return region?.placement.countryCodes ?? [];
}

/** The region's reviewed location IDs, or null when the region names none and the location is free text. */
export function manualVpsLocationChoices(region: HostingRegionPayload | undefined): readonly string[] | null {
    return region?.placement.locationIds ?? null;
}

/** Applies a region choice: country and location reset to the region's only choice, else to unselected. */
export function selectManualVpsRegion(values: ManualVpsFormValues, regions: readonly HostingRegionPayload[], key: string): ManualVpsFormValues {
    const region = manualVpsRegion(regions, key);
    const countries = manualVpsCountryChoices(region);
    const locations = manualVpsLocationChoices(region);
    return {
        ...values,
        region: key,
        countryCode: countries.length === 1 ? countries[0]! : "",
        locationId: locations?.length === 1 ? locations[0]! : "",
    };
}

/** The game slots a vCPU entry yields (one per two vCPUs), or null while the entry is not a valid count. */
export function manualVpsSlotCount(vCpu: string): number | null {
    const count = parseVCpu(vCpu);
    return count === null ? null : Math.floor(count / 2);
}

/** Validates every field against the backend grammar and catalog, returning the exact wire input or per-field errors. */
export function validateManualVpsForm(values: ManualVpsFormValues, choices: ManualVpsChoices): ManualVpsValidation {
    const region = manualVpsRegion(choices.regions, values.region);
    const errors: Partial<Record<ManualVpsField, string>> = {
        provider: providerError(values.provider, choices.providers),
        serviceName: serviceNameError(values.serviceName.trim()),
        sshLogin: sshLoginError(values.sshLogin.trim()),
        vCpu: parseVCpu(values.vCpu) === null ? `Enter a whole number of vCPUs from ${MANUAL_VPS_MINIMUM_VCPU} to ${MANUAL_VPS_MAXIMUM_VCPU}.` : undefined,
        region: region === undefined ? "Choose a region from the catalog." : undefined,
        countryCode: countryCodeError(values.countryCode, region),
        locationId: locationIdError(values.locationId.trim(), region),
        publicHostname: publicHostnameError(values.publicHostname.trim()),
        datacenter: datacenterError(values.datacenter.trim()),
    };
    const failed = Object.fromEntries(Object.entries(errors).filter(([, message]) => message !== undefined));
    if (Object.keys(failed).length > 0) return { ok: false, errors: failed };
    return { ok: true, input: buildManualVpsInput(values) };
}

/** Builds the wire input from already-validated values, trimming text and sending blank optional fields as null. */
export function buildManualVpsInput(values: ManualVpsFormValues): ManualVpsInput {
    return {
        provider: values.provider,
        serviceName: values.serviceName.trim(),
        sshLogin: values.sshLogin.trim(),
        vCpu: Number(values.vCpu.trim()),
        region: values.region,
        countryCode: values.countryCode,
        locationId: values.locationId.trim(),
        publicHostname: values.publicHostname.trim() || null,
        datacenter: values.datacenter.trim() || null,
    };
}

/** The IPv4 address an `root@<IPv4>` login names, or null when the login is not in that form. */
export function manualVpsLoginAddress(sshLogin: string): string | null {
    const match = /^root@(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(sshLogin.trim());
    return match ? match[1]! : null;
}

/** Requires one of the listed manual-entry providers. */
function providerError(provider: string, providers: readonly ManualEntryProvider[]) {
    return providers.some((entry) => entry.provider === provider) ? undefined : "Choose a provider.";
}

/** Requires the permanent host name grammar. */
function serviceNameError(serviceName: string) {
    if (SERVICE_NAME_PATTERN.test(serviceName)) return undefined;
    return "Use 1–64 letters, digits, dots or hyphens, starting with a letter or digit.";
}

/** Requires exactly `root@` and a public IPv4 address. */
function sshLoginError(sshLogin: string) {
    const address = manualVpsLoginAddress(sshLogin);
    if (address === null) return "Enter root@ followed by the VPS's public IPv4 address.";
    const octets = parseIpv4(address);
    if (octets === null) return "Enter a valid IPv4 address after root@.";
    return isPublicIpv4(octets) ? undefined : "The address is private, reserved or otherwise not a public IPv4 address.";
}

/** Requires a country the chosen region's placement accepts. */
function countryCodeError(countryCode: string, region: HostingRegionPayload | undefined) {
    if (region === undefined) return "Choose a region first.";
    if (!COUNTRY_CODE_PATTERN.test(countryCode) || !region.placement.countryCodes.includes(countryCode)) return "Choose one of the region's countries.";
    return undefined;
}

/** Requires the location grammar and, when the region names locations, one of them. */
function locationIdError(locationId: string, region: HostingRegionPayload | undefined) {
    if (region === undefined) return "Choose a region first.";
    const choices = manualVpsLocationChoices(region);
    if (choices !== null) return choices.includes(locationId) ? undefined : "Choose one of the region's locations.";
    if (LOCATION_ID_PATTERN.test(locationId)) return undefined;
    return "Use a short location code: letters, digits, dots, underscores, colons or hyphens.";
}

/** Accepts a blank hostname or a fully qualified DNS name. */
function publicHostnameError(hostname: string) {
    if (hostname === "" || isDnsName(hostname)) return undefined;
    return "Enter a DNS name such as play.example.com, or leave it blank.";
}

/** Accepts a blank datacenter or a short label in the control plane's datacenter-name grammar. */
function datacenterError(datacenter: string) {
    if (datacenter === "" || DATACENTER_PATTERN.test(datacenter)) return undefined;
    return "Use up to 64 letters, digits, spaces or . _ : ( ) -, starting with a letter or digit.";
}

/** Parses a whole vCPU count within the accepted range, else null. */
function parseVCpu(text: string): number | null {
    const trimmed = text.trim();
    if (!/^\d{1,2}$/u.test(trimmed)) return null;
    const count = Number(trimmed);
    return count >= MANUAL_VPS_MINIMUM_VCPU && count <= MANUAL_VPS_MAXIMUM_VCPU ? count : null;
}

/** Parses dotted-quad IPv4 octets without leading zeros, else null. */
function parseIpv4(address: string): number[] | null {
    const parts = address.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/u.test(part))) return null;
    const octets = parts.map(Number);
    return octets.every((octet) => octet <= 255) ? octets : null;
}

/** Whether an IPv4 address lies outside every private, shared, loopback, link-local, documentation and reserved range. */
function isPublicIpv4([a, b, c]: number[]): boolean {
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b! >= 64 && b! <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false;
    return true;
}

/** Whether text is a multi-label DNS name with a non-numeric top-level label. */
function isDnsName(hostname: string): boolean {
    if (hostname.length > MAXIMUM_HOSTNAME_LENGTH) return false;
    const labels = hostname.split(".");
    if (labels.length < 2 || !labels.every((label) => HOSTNAME_LABEL_PATTERN.test(label))) return false;
    return !/^\d+$/u.test(labels.at(-1)!);
}
