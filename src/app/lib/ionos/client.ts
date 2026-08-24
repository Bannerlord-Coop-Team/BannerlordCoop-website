import "server-only";

import {
    createManagedServerIdentity,
    IONOS_MANAGED_DATACENTER_DESCRIPTION,
    IONOS_MANAGED_DATACENTER_NAME,
    IONOS_MANAGED_LAN_NAME,
    getIonosServerPreset,
    getIonosServerPresetFromName,
    isIonosLocationId,
    isIonosResourceId,
    isIonosServerPreset,
    isManagedDatacenter,
    isManagedServerName,
    isSshPublicKey,
    type IonosServerPreset,
} from "@/app/lib/ionos/resources";
import { randomUUID } from "node:crypto";

const IONOS_API_BASE = "https://api.ionos.com/cloudapi/v6";
const IONOS_REQUEST_TIMEOUT_MS = 20_000;
const IONOS_PROVISIONING_POLL_MS = 1_000;
const IONOS_PROVISIONING_POLL_ATTEMPTS = 45;

type IonosCollection<T> = {
    items?: T[];
};

type IonosDatacenter = {
    id?: string;
    metadata?: {
        state?: string;
    };
    properties?: {
        description?: string;
        location?: string;
        name?: string;
    };
};

type IonosLocationResource = {
    id?: string;
    properties?: {
        features?: string[];
        imageAliases?: string[];
        name?: string;
    };
};

type IonosTemplate = {
    id?: string;
    metadata?: {
        state?: string;
    };
    properties?: {
        category?: string;
        cores?: number;
        name?: string;
        ram?: number;
        storageSize?: number;
    };
};

type IonosLan = {
    id?: string;
    metadata?: {
        state?: string;
    };
    properties?: {
        name?: string;
        public?: boolean;
    };
};

type IonosNic = {
    properties?: {
        ips?: string[] | null;
    };
};

type IonosVolume = {
    properties?: {
        name?: string;
        size?: number;
        type?: string;
    };
};

type IonosServer = {
    id?: string;
    metadata?: {
        state?: string;
    };
    properties?: {
        cores?: number;
        name?: string;
        ram?: number;
        type?: string;
        vmState?: string;
    };
    entities?: {
        nics?: IonosCollection<IonosNic>;
        volumes?: IonosCollection<IonosVolume>;
    };
};

type IonosErrorResponse = {
    messages?: Array<{
        message?: string;
    }>;
};

export type IonosLocation = {
    id: string;
    name: string;
};

export type ManagedIonosServer = {
    cores: number | null;
    datacenterId: string;
    id: string;
    ips: string[];
    location: string;
    name: string;
    preset: IonosServerPreset | null;
    provisioningState: string;
    ramMb: number | null;
    storageGb: number | null;
    type: string;
    vmState: string;
};

export type IonosProvisioningSummary = {
    imageAlias: string;
    location: string;
};

export type CreateIonosServerInput = {
    location: string;
    preset: IonosServerPreset;
    sshPublicKey: string;
};

type IonosProvisioningConfig = IonosProvisioningSummary & CreateIonosServerInput;

export class IonosClientError extends Error {
    constructor(
        public readonly userMessage: string,
        public readonly status?: number,
    ) {
        super(userMessage);
        this.name = "IonosClientError";
    }
}

function getIonosToken() {
    const token = (
        process.env.IONOS_CLOUD_API_TOKEN ??
        process.env.IONOS_TOKEN_SECRET
    )?.trim();

    if (!token) {
        throw new IonosClientError(
            "IONOS is not configured. Add IONOS_CLOUD_API_TOKEN to the server environment.",
        );
    }

    return token;
}

export function getIonosProvisioningSummary(): IonosProvisioningSummary {
    const location = process.env.IONOS_LOCATION?.trim() || "de/fra/2";

    if (!isIonosLocationId(location)) {
        throw new IonosClientError(
            "IONOS_LOCATION must be an IONOS location such as de/fra/2.",
        );
    }

    return {
        imageAlias: process.env.IONOS_IMAGE_ALIAS?.trim() || "ubuntu:24.04",
        location,
    };
}

function getProvisioningConfig(input: CreateIonosServerInput): IonosProvisioningConfig {
    const summary = getIonosProvisioningSummary();
    const location = input.location.trim();
    const sshPublicKey = input.sshPublicKey.trim();

    getIonosToken();

    if (!isIonosServerPreset(input.preset)) {
        throw new IonosClientError("Choose a valid IONOS server preset.");
    }

    if (!isIonosLocationId(location)) {
        throw new IonosClientError("Choose a valid IONOS region.");
    }

    if (!summary.imageAlias || summary.imageAlias.length > 100) {
        throw new IonosClientError("IONOS_IMAGE_ALIAS is invalid.");
    }

    if (!isSshPublicKey(sshPublicKey)) {
        throw new IonosClientError(
            "Enter a valid SSH public key. Private keys must never be submitted.",
        );
    }

    return {
        ...summary,
        location,
        preset: input.preset,
        sshPublicKey,
    };
}

async function ionosRequest<T>(path: string, init: RequestInit = {}) {
    let response: Response;

    try {
        response = await fetch(`${IONOS_API_BASE}${path}`, {
            ...init,
            cache: "no-store",
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${getIonosToken()}`,
                ...(init.body ? { "Content-Type": "application/json" } : {}),
                ...init.headers,
            },
            signal: AbortSignal.timeout(IONOS_REQUEST_TIMEOUT_MS),
        });
    } catch {
        throw new IonosClientError(
            "IONOS could not be reached. Try the operation again in a moment.",
        );
    }

    if (!response.ok) {
        let errorBody: IonosErrorResponse | undefined;

        try {
            errorBody = (await response.json()) as IonosErrorResponse;
        } catch {
            errorBody = undefined;
        }

        const providerMessage = errorBody?.messages
            ?.map((message) => message.message?.trim())
            .filter(Boolean)
            .join(" ");

        if (response.status === 401) {
            throw new IonosClientError(
                "IONOS rejected the API token. Restart the website after changing its environment and verify IONOS_CLOUD_API_TOKEN in the running environment.",
                response.status,
            );
        }

        if (response.status === 403) {
            throw new IonosClientError(
                "The IONOS token is valid but does not have permission for this operation.",
                response.status,
            );
        }

        throw new IonosClientError(
            providerMessage || `IONOS rejected the operation (${response.status}).`,
            response.status,
        );
    }

    const responseText = await response.text();
    if (!responseText) return undefined as T;

    try {
        return JSON.parse(responseText) as T;
    } catch {
        throw new IonosClientError("IONOS returned an unreadable response.");
    }
}

function delay(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForResourceAvailable<T extends { metadata?: { state?: string } }>(
    path: string,
    resourceLabel: string,
): Promise<T> {
    for (let attempt = 0; attempt < IONOS_PROVISIONING_POLL_ATTEMPTS; attempt += 1) {
        try {
            const resource = await ionosRequest<T>(path);
            const state = resource.metadata?.state;

            if (state === "AVAILABLE") return resource;
            if (state === "FAILED") {
                throw new IonosClientError(
                    `IONOS could not provision the ${resourceLabel}.`,
                );
            }
        } catch (error) {
            const stillPropagating =
                error instanceof IonosClientError && error.status === 404;
            if (!stillPropagating) throw error;
        }

        await delay(IONOS_PROVISIONING_POLL_MS);
    }

    throw new IonosClientError(
        `IONOS is still provisioning the ${resourceLabel}. Try creating the server again in a moment.`,
    );
}

async function getIonosCubeTemplate(preset: IonosServerPreset) {
    const expected = getIonosServerPreset(preset);
    const templates = await ionosRequest<IonosCollection<IonosTemplate>>(
        "/templates?depth=1&limit=1000",
    );
    const template = (templates.items ?? []).find((candidate) =>
        Boolean(candidate.id) &&
        isIonosResourceId(candidate.id ?? "") &&
        candidate.metadata?.state === "AVAILABLE" &&
        candidate.properties?.category === "Basic Templates" &&
        candidate.properties?.name === expected.templateName &&
        candidate.properties?.cores === expected.cores &&
        candidate.properties?.ram === expected.ramMb &&
        candidate.properties?.storageSize === expected.storageGb
    );

    if (!template?.id) {
        throw new IonosClientError(
            `IONOS does not currently offer the ${expected.templateName} configuration required for ${preset}.`,
        );
    }

    return {
        id: template.id,
        ...expected,
    };
}

export async function listIonosLocations(): Promise<IonosLocation[]> {
    const { imageAlias } = getIonosProvisioningSummary();
    const locations = await ionosRequest<IonosCollection<IonosLocationResource>>(
        "/locations?depth=1&limit=1000",
    );

    return (locations.items ?? [])
        .filter(
            (location): location is IonosLocationResource & {
                id: string;
                properties: NonNullable<IonosLocationResource["properties"]>;
            } =>
                Boolean(location.id) &&
                isIonosLocationId(location.id ?? "") &&
                Boolean(location.properties) &&
                Boolean(location.properties?.features?.includes("cube")) &&
                Boolean(location.properties?.imageAliases?.includes(imageAlias)),
        )
        .map((location) => ({
            id: location.id,
            name: location.properties.name || location.id,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

async function getManagedDatacenters() {
    const datacenters = await ionosRequest<IonosCollection<IonosDatacenter>>(
        "/datacenters?depth=1&limit=1000",
    );

    return (datacenters.items ?? []).filter(
        (datacenter): datacenter is IonosDatacenter & {
            id: string;
            properties: NonNullable<IonosDatacenter["properties"]>;
        } =>
            Boolean(datacenter.id) &&
            isIonosResourceId(datacenter.id ?? "") &&
            Boolean(datacenter.properties) &&
            isManagedDatacenter(datacenter.properties ?? {}),
    );
}

async function ensureManagedDatacenter(location: string) {
    const existing = (await getManagedDatacenters()).find(
        (datacenter) => datacenter.properties.location === location,
    );
    if (existing) {
        await waitForResourceAvailable<IonosDatacenter>(
            `/datacenters/${encodeURIComponent(existing.id)}?depth=1`,
            "data center",
        );
        return existing;
    }

    const created = await ionosRequest<IonosDatacenter>("/datacenters?depth=1", {
        method: "POST",
        body: JSON.stringify({
            properties: {
                description: IONOS_MANAGED_DATACENTER_DESCRIPTION,
                location,
                name: IONOS_MANAGED_DATACENTER_NAME,
            },
        }),
    });

    if (!created.id || !isIonosResourceId(created.id)) {
        throw new IonosClientError("IONOS did not return a valid data center ID.");
    }

    await waitForResourceAvailable<IonosDatacenter>(
        `/datacenters/${encodeURIComponent(created.id)}?depth=1`,
        "data center",
    );

    return {
        ...created,
        id: created.id,
        properties: created.properties ?? {
            description: IONOS_MANAGED_DATACENTER_DESCRIPTION,
            location,
            name: IONOS_MANAGED_DATACENTER_NAME,
        },
    };
}

async function ensureManagedPublicLan(datacenterId: string) {
    const lans = await ionosRequest<IonosCollection<IonosLan>>(
        `/datacenters/${encodeURIComponent(datacenterId)}/lans?depth=1&limit=1000`,
    );
    const existing = (lans.items ?? []).find(
        (lan) => lan.properties?.name === IONOS_MANAGED_LAN_NAME && lan.properties.public,
    );
    if (existing?.id && /^\d+$/.test(existing.id)) {
        await waitForResourceAvailable<IonosLan>(
            `/datacenters/${encodeURIComponent(datacenterId)}/lans/${encodeURIComponent(existing.id)}?depth=1`,
            "public LAN",
        );
        await waitForResourceAvailable<IonosDatacenter>(
            `/datacenters/${encodeURIComponent(datacenterId)}?depth=1`,
            "data center",
        );
        return existing.id;
    }

    const created = await ionosRequest<IonosLan>(
        `/datacenters/${encodeURIComponent(datacenterId)}/lans?depth=1`,
        {
            method: "POST",
            body: JSON.stringify({
                properties: {
                    name: IONOS_MANAGED_LAN_NAME,
                    public: true,
                },
            }),
        },
    );

    if (!created.id || !/^\d+$/.test(created.id)) {
        throw new IonosClientError("IONOS did not return a valid LAN ID.");
    }

    await waitForResourceAvailable<IonosLan>(
        `/datacenters/${encodeURIComponent(datacenterId)}/lans/${encodeURIComponent(created.id)}?depth=1`,
        "public LAN",
    );
    await waitForResourceAvailable<IonosDatacenter>(
        `/datacenters/${encodeURIComponent(datacenterId)}?depth=1`,
        "data center",
    );

    return created.id;
}

type ManagedDatacenter = IonosDatacenter & {
    id: string;
    properties: NonNullable<IonosDatacenter["properties"]>;
};

type ManagedServerResource = IonosServer & {
    id: string;
    properties: NonNullable<IonosServer["properties"]> & { name: string };
};

function isManagedServerResource(server: IonosServer): server is ManagedServerResource {
    return (
        Boolean(server.id) &&
        isIonosResourceId(server.id ?? "") &&
        Boolean(server.properties?.name) &&
        isManagedServerName(server.properties?.name)
    );
}

function mapManagedServer(
    server: ManagedServerResource,
    datacenter: ManagedDatacenter,
): ManagedIonosServer {
    const volumeSizes = (server.entities?.volumes?.items ?? [])
        .map((volume) => volume.properties?.size)
        .filter((size): size is number => typeof size === "number");

    return {
        cores: server.properties.cores ?? null,
        datacenterId: datacenter.id,
        id: server.id,
        ips: (server.entities?.nics?.items ?? []).flatMap(
            (nic) => nic.properties?.ips ?? [],
        ),
        location: datacenter.properties.location ?? "Unknown",
        name: server.properties.name,
        preset: getIonosServerPresetFromName(server.properties.name),
        provisioningState: server.metadata?.state ?? "UNKNOWN",
        ramMb: server.properties.ram ?? null,
        storageGb: volumeSizes.length > 0
            ? volumeSizes.reduce((total, size) => total + size, 0)
            : null,
        type: server.properties.type ?? "UNKNOWN",
        vmState: server.properties.vmState ?? "UNKNOWN",
    };
}

export async function listManagedIonosServers(): Promise<ManagedIonosServer[]> {
    const datacenters = await getManagedDatacenters();
    const serversByDatacenter = await Promise.all(
        datacenters.map(async (datacenter) => {
            const servers = await ionosRequest<IonosCollection<IonosServer>>(
                `/datacenters/${encodeURIComponent(datacenter.id)}/servers?depth=3&limit=1000`,
            );

            return (servers.items ?? [])
                .filter(isManagedServerResource)
                .map((server) => mapManagedServer(server, datacenter));
        }),
    );

    return serversByDatacenter.flat().sort((left, right) =>
        left.name.localeCompare(right.name),
    );
}

export async function getManagedIonosServer(
    datacenterId: string,
    serverId: string,
): Promise<ManagedIonosServer> {
    if (!isIonosResourceId(datacenterId) || !isIonosResourceId(serverId)) {
        throw new IonosClientError("The IONOS server reference is invalid.");
    }

    const datacenter = await ionosRequest<IonosDatacenter>(
        `/datacenters/${encodeURIComponent(datacenterId)}?depth=1`,
    );
    if (
        !datacenter.id ||
        !datacenter.properties ||
        !isManagedDatacenter(datacenter.properties)
    ) {
        throw new IonosClientError(
            "Only data centers managed by this website can be viewed.",
        );
    }

    const server = await ionosRequest<IonosServer>(
        `/datacenters/${encodeURIComponent(datacenterId)}/servers/${encodeURIComponent(serverId)}?depth=3`,
    );
    if (!isManagedServerResource(server)) {
        throw new IonosClientError("Only servers created by this website can be viewed.");
    }

    return mapManagedServer(server, {
        ...datacenter,
        id: datacenter.id,
        properties: datacenter.properties,
    });
}

export async function createManagedIonosServer(input: CreateIonosServerInput) {
    const config = getProvisioningConfig(input);
    const [locations, template] = await Promise.all([
        listIonosLocations(),
        getIonosCubeTemplate(config.preset),
    ]);

    if (!locations.some((location) => location.id === config.location)) {
        throw new IonosClientError(
            "The selected IONOS region does not support this server image and Cube instances.",
        );
    }

    const datacenter = await ensureManagedDatacenter(config.location);
    const lanId = await ensureManagedPublicLan(datacenter.id);
    const identity = createManagedServerIdentity(
        new Date(),
        randomUUID(),
        config.preset,
    );

    const server = await ionosRequest<IonosServer>(
        `/datacenters/${encodeURIComponent(datacenter.id)}/servers?depth=3`,
        {
            method: "POST",
            body: JSON.stringify({
                properties: {
                    availabilityZone: "AUTO",
                    hostname: identity.hostname,
                    name: identity.name,
                    templateUuid: template.id,
                    type: "CUBE",
                },
                entities: {
                    volumes: {
                        items: [
                            {
                                properties: {
                                    imageAlias: config.imageAlias,
                                    licenceType: "LINUX",
                                    name: `${identity.name}-boot`,
                                    sshKeys: [config.sshPublicKey],
                                    type: "DAS",
                                },
                            },
                        ],
                    },
                    nics: {
                        items: [
                            {
                                properties: {
                                    dhcp: true,
                                    firewallActive: true,
                                    firewallType: "INGRESS",
                                    ips: null,
                                    lan: Number(lanId),
                                    name: `${identity.name}-public`,
                                },
                                entities: {
                                    firewallrules: {
                                        items: [
                                            {
                                                properties: {
                                                    ipVersion: "IPv4",
                                                    name: "Allow SSH",
                                                    portRangeEnd: 22,
                                                    portRangeStart: 22,
                                                    protocol: "TCP",
                                                    type: "INGRESS",
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                },
            }),
        },
    );

    if (!server.id || !isIonosResourceId(server.id)) {
        throw new IonosClientError("IONOS did not return a valid server ID.");
    }

    return {
        id: server.id,
        name: server.properties?.name ?? identity.name,
        preset: config.preset,
    };
}

export async function destroyManagedIonosServer(
    datacenterId: string,
    serverId: string,
) {
    const server = await getManagedIonosServer(datacenterId, serverId);

    await ionosRequest<void>(
        `/datacenters/${encodeURIComponent(datacenterId)}/servers/${encodeURIComponent(serverId)}?deleteVolumes=true`,
        { method: "DELETE" },
    );

    return {
        name: server.name,
    };
}
