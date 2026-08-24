export const IONOS_MANAGED_DATACENTER_NAME = "Bannerlord Coop Hosting";
export const IONOS_MANAGED_DATACENTER_DESCRIPTION =
    "Managed by the Bannerlord Coop website server control plane.";
export const IONOS_MANAGED_LAN_NAME = "Bannerlord Coop Public";
export const IONOS_MANAGED_SERVER_PREFIX = "bannerlord-coop-";

export const IONOS_SERVER_PRESETS = {
    Standard: {
        cores: 2,
        ramMb: 4096,
        storageGb: 120,
        templateName: "Basic Cube S",
    },
    Premium: {
        cores: 4,
        ramMb: 8192,
        storageGb: 240,
        templateName: "Basic Cube M",
    },
} as const;

export type IonosServerPreset = keyof typeof IONOS_SERVER_PRESETS;

const RESOURCE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isIonosResourceId(value: string) {
    return RESOURCE_ID_PATTERN.test(value);
}

export function isIonosLocationId(value: string) {
    return /^[a-z]{2}\/[a-z0-9]+(?:\/[a-z0-9]+)?$/i.test(value);
}

export function isIonosServerPreset(value: string): value is IonosServerPreset {
    return value === "Standard" || value === "Premium";
}

export function isSshPublicKey(value: string) {
    if (
        !value ||
        value.length > 8192 ||
        value.includes("PRIVATE KEY") ||
        /[\r\n]/.test(value)
    ) return false;

    const [keyType, keyData] = value.trim().split(/\s+/, 3);
    const supportedType =
        keyType === "ssh-ed25519" ||
        keyType === "ssh-rsa" ||
        keyType?.startsWith("ecdsa-sha2-") ||
        keyType?.startsWith("sk-ssh-") ||
        keyType?.startsWith("sk-ecdsa-");

    return Boolean(supportedType && keyData && /^[A-Za-z0-9+/]+={0,3}$/.test(keyData));
}

export function getIonosServerPreset(value: IonosServerPreset) {
    return IONOS_SERVER_PRESETS[value];
}

export function getIonosServerPresetFromName(name: string | undefined) {
    if (name?.startsWith(`${IONOS_MANAGED_SERVER_PREFIX}standard-`)) {
        return "Standard" as const;
    }
    if (name?.startsWith(`${IONOS_MANAGED_SERVER_PREFIX}premium-`)) {
        return "Premium" as const;
    }
    return null;
}

export function isManagedDatacenter(properties: {
    name?: string;
    description?: string;
}) {
    return (
        properties.name === IONOS_MANAGED_DATACENTER_NAME &&
        properties.description === IONOS_MANAGED_DATACENTER_DESCRIPTION
    );
}

export function isManagedServerName(name: string | undefined) {
    return Boolean(name?.startsWith(IONOS_MANAGED_SERVER_PREFIX));
}

export function createManagedServerIdentity(
    now: Date,
    suffix: string,
    preset: IonosServerPreset,
) {
    const date = now.toISOString().slice(0, 10).replaceAll("-", "");
    const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);

    if (!safeSuffix) throw new Error("A server name suffix is required.");

    const name = `${IONOS_MANAGED_SERVER_PREFIX}${preset.toLowerCase()}-${date}-${safeSuffix}`;

    return {
        hostname: name.slice(0, 63),
        name,
    };
}
