export type LiveConsoleServer = {
    id: string;
    name: string;
    address: string;
    nodeId: string;
    provider: string;
};

const SERVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CATALOG_KEYS = new Set(["address", "id", "name", "nodeId", "provider"]);

function catalogString(
    value: unknown,
    field: keyof LiveConsoleServer,
    index: number,
) {
    if (typeof value !== "string" || !value.trim() || value.length > 200) {
        throw new Error(
            `CONSOLE_SERVER_CATALOG[${index}].${field} must be a non-empty string no longer than 200 characters.`,
        );
    }
    return value.trim();
}

export function parseConsoleServerCatalog(
    raw: string | undefined,
    fallback: readonly LiveConsoleServer[],
): readonly LiveConsoleServer[] {
    if (!raw?.trim()) return fallback;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("CONSOLE_SERVER_CATALOG must be a JSON array.");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("CONSOLE_SERVER_CATALOG must contain at least one server.");
    }

    const serverIds = new Set<string>();
    return Object.freeze(parsed.map((value, index) => {
        if (!value || Array.isArray(value) || typeof value !== "object") {
            throw new Error(`CONSOLE_SERVER_CATALOG[${index}] must be an object.`);
        }
        const record = value as Record<string, unknown>;
        const unknownKey = Object.keys(record).find((key) => !CATALOG_KEYS.has(key));
        if (unknownKey) {
            throw new Error(
                `CONSOLE_SERVER_CATALOG[${index}] contains unsupported key ${unknownKey}.`,
            );
        }

        const server: LiveConsoleServer = {
            id: catalogString(record.id, "id", index),
            name: catalogString(record.name, "name", index),
            address: catalogString(record.address, "address", index),
            nodeId: catalogString(record.nodeId, "nodeId", index),
            provider: catalogString(record.provider, "provider", index),
        };
        if (!SERVER_ID_PATTERN.test(server.id)) {
            throw new Error(`CONSOLE_SERVER_CATALOG[${index}].id is invalid.`);
        }
        if (serverIds.has(server.id)) {
            throw new Error(`CONSOLE_SERVER_CATALOG contains duplicate server ID ${server.id}.`);
        }
        serverIds.add(server.id);
        return Object.freeze(server);
    }));
}
