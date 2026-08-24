import { posix as path } from "node:path";

export const DEFAULT_SERVER_ID = "bannerlord-live-15-204-120-17";
const DEFAULT_READY_LOG_PATTERN = '"phase":"serving"';
const SERVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DOCKER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,127}$/;
// Docker accepts unique ID prefixes shorter than the conventional 12 characters.
// Reject every all-hex value so it cannot resolve as a container ID by accident.
const DOCKER_ID_PATTERN = /^[a-f0-9]{1,64}$/i;
const SERVER_CONFIGURATION_KEYS = new Set([
    "container",
    "dataPath",
    "dataVolume",
    "readinessPattern",
    "udpPort",
    "updateImage",
]);

function parseJsonObject(raw, name) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${name} must be a JSON object.`);
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error(`${name} must be a JSON object.`);
    }
    return parsed;
}

function nonEmptyString(value, name, maximum = 1024) {
    if (typeof value !== "string" || !value.trim() || value.length > maximum) {
        throw new Error(`${name} must be a non-empty string no longer than ${maximum} characters.`);
    }
    return value.trim();
}

function stableDockerName(value, name) {
    const normalized = nonEmptyString(value, name, 128);
    if (!DOCKER_NAME_PATTERN.test(normalized) || DOCKER_ID_PATTERN.test(normalized)) {
        throw new Error(`${name} must be a stable Docker name, not a container ID.`);
    }
    return normalized;
}

function dataPath(value, name) {
    const normalized = nonEmptyString(value, name, 512);
    if (
        !normalized.startsWith("/") ||
        normalized === "/" ||
        path.normalize(normalized) !== normalized ||
        normalized.includes("\0")
    ) {
        throw new Error(`${name} must be a normalized absolute container path.`);
    }
    return normalized;
}

function udpPort(value, name) {
    const normalized = typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : value;
    if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > 65535) {
        throw new Error(`${name} must be an integer from 1 through 65535.`);
    }
    return normalized;
}

function optionalImage(value, name) {
    if (value === undefined || value === null || value === "") return null;
    const normalized = nonEmptyString(value, name, 512);
    if (/\s/.test(normalized)) {
        throw new Error(`${name} must be a Docker image reference without whitespace.`);
    }
    return normalized;
}

function legacyContainerMap(environment) {
    const raw = environment.AGENT_SERVER_CONTAINERS?.trim();
    const fallbackContainer = environment.BANNERLORD_CONTAINER?.trim();
    const parsed = raw
        ? parseJsonObject(raw, "AGENT_SERVER_CONTAINERS")
        : fallbackContainer
            ? { [DEFAULT_SERVER_ID]: fallbackContainer }
            : null;
    if (!parsed || Object.keys(parsed).length === 0) {
        throw new Error("Set AGENT_SERVERS, AGENT_SERVER_CONTAINERS, or BANNERLORD_CONTAINER.");
    }
    return new Map(Object.entries(parsed).map(([serverId, container]) => [
        serverId,
        stableDockerName(container, `Container for ${serverId}`),
    ]));
}

function legacyUpdateImageMap(environment, serverIds) {
    const raw = environment.AGENT_SERVER_UPDATE_IMAGES?.trim();
    const fallbackImage = optionalImage(
        environment.BANNERLORD_UPDATE_IMAGE?.trim(),
        "BANNERLORD_UPDATE_IMAGE",
    );
    if (!raw) {
        return new Map(serverIds.map((serverId) => [serverId, fallbackImage]));
    }

    const parsed = parseJsonObject(raw, "AGENT_SERVER_UPDATE_IMAGES");
    for (const serverId of Object.keys(parsed)) {
        if (!serverIds.includes(serverId)) {
            throw new Error(`AGENT_SERVER_UPDATE_IMAGES contains unknown server ${serverId}.`);
        }
    }
    return new Map(serverIds.map((serverId) => [
        serverId,
        optionalImage(parsed[serverId] ?? fallbackImage, `Update image for ${serverId}`),
    ]));
}

function validateServerId(serverId, source) {
    if (!SERVER_ID_PATTERN.test(serverId)) {
        throw new Error(`${source} contains invalid server ID ${serverId}.`);
    }
}

function assertUniqueConfigurations(configurations) {
    const containers = new Map();
    const volumes = new Map();
    const ports = new Map();

    for (const [serverId, configuration] of configurations) {
        for (const [label, value, seen] of [
            ["container", configuration.container, containers],
            ["data volume", configuration.dataVolume, volumes],
            ["UDP port", configuration.udpPort, ports],
        ]) {
            const existingServerId = seen.get(value);
            if (existingServerId) {
                throw new Error(
                    `${serverId} and ${existingServerId} cannot share the same ${label}.`,
                );
            }
            seen.set(value, serverId);
        }
    }
}

export function loadServerConfigurations(environment = process.env) {
    const defaultUpdateImage = optionalImage(
        environment.BANNERLORD_UPDATE_IMAGE?.trim(),
        "BANNERLORD_UPDATE_IMAGE",
    );
    const defaultReadinessPattern = nonEmptyString(
        environment.BANNERLORD_READY_LOG_PATTERN?.trim() || DEFAULT_READY_LOG_PATTERN,
        "BANNERLORD_READY_LOG_PATTERN",
        1000,
    );
    const raw = environment.AGENT_SERVERS?.trim();
    const configurations = new Map();

    if (raw) {
        const parsed = parseJsonObject(raw, "AGENT_SERVERS");
        const entries = Object.entries(parsed);
        if (entries.length === 0) {
            throw new Error("AGENT_SERVERS must configure at least one server.");
        }

        for (const [serverId, value] of entries) {
            validateServerId(serverId, "AGENT_SERVERS");
            if (!value || Array.isArray(value) || typeof value !== "object") {
                throw new Error(`AGENT_SERVERS.${serverId} must be an object.`);
            }
            const unknownKey = Object.keys(value).find(
                (key) => !SERVER_CONFIGURATION_KEYS.has(key),
            );
            if (unknownKey) {
                throw new Error(`AGENT_SERVERS.${serverId} contains unsupported key ${unknownKey}.`);
            }

            configurations.set(serverId, Object.freeze({
                container: stableDockerName(
                    value.container,
                    `AGENT_SERVERS.${serverId}.container`,
                ),
                dataPath: dataPath(
                    value.dataPath ?? environment.BANNERLORD_DATA_PATH ?? "/srv/data",
                    `AGENT_SERVERS.${serverId}.dataPath`,
                ),
                dataVolume: stableDockerName(
                    value.dataVolume,
                    `AGENT_SERVERS.${serverId}.dataVolume`,
                ),
                readinessPattern: nonEmptyString(
                    value.readinessPattern ?? defaultReadinessPattern,
                    `AGENT_SERVERS.${serverId}.readinessPattern`,
                    1000,
                ),
                udpPort: udpPort(
                    value.udpPort,
                    `AGENT_SERVERS.${serverId}.udpPort`,
                ),
                updateImage: optionalImage(
                    value.updateImage ?? defaultUpdateImage,
                    `AGENT_SERVERS.${serverId}.updateImage`,
                ),
            }));
        }
    } else {
        const containerMap = legacyContainerMap(environment);
        const serverIds = [...containerMap.keys()];
        const updateImages = legacyUpdateImageMap(environment, serverIds);
        const legacyDataPath = dataPath(
            environment.BANNERLORD_DATA_PATH?.trim() || "/srv/data",
            "BANNERLORD_DATA_PATH",
        );
        const legacyDataVolume = stableDockerName(
            environment.BANNERLORD_DATA_VOLUME?.trim() || "bannerlordcoop-data",
            "BANNERLORD_DATA_VOLUME",
        );
        const legacyUdpPort = udpPort(
            environment.BANNERLORD_UDP_PORT?.trim() || "4200",
            "BANNERLORD_UDP_PORT",
        );

        for (const [serverId, container] of containerMap) {
            validateServerId(serverId, "AGENT_SERVER_CONTAINERS");
            configurations.set(serverId, Object.freeze({
                container,
                dataPath: legacyDataPath,
                dataVolume: legacyDataVolume,
                readinessPattern: defaultReadinessPattern,
                udpPort: legacyUdpPort,
                updateImage: updateImages.get(serverId) ?? null,
            }));
        }
    }

    assertUniqueConfigurations(configurations);
    return configurations;
}
