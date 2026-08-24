import "server-only";

import {
    parseConsoleServerCatalog,
    type LiveConsoleServer,
} from "@/app/lib/console/catalog";

export type { LiveConsoleServer } from "@/app/lib/console/catalog";

export const LIVE_CONSOLE_SERVER_ID = "bannerlord-live-15-204-120-17";

const DEFAULT_LIVE_CONSOLE_SERVERS: readonly LiveConsoleServer[] = [
    {
        id: LIVE_CONSOLE_SERVER_ID,
        name: "Bannerlord Live Server",
        address: "15.204.120.17",
        nodeId: "vps-15-204-120-17",
        provider: "External VPS",
    },
];

export function listLiveConsoleServers() {
    return parseConsoleServerCatalog(
        process.env.CONSOLE_SERVER_CATALOG,
        DEFAULT_LIVE_CONSOLE_SERVERS,
    );
}

export function getLiveConsoleServer(serverId: string) {
    return listLiveConsoleServers().find((server) => server.id === serverId) ?? null;
}

export function getConsoleGatewayUrl() {
    const value = process.env.CONSOLE_GATEWAY_URL?.trim();
    if (!value) return null;

    try {
        const url = new URL(value);
        const localDevelopment =
            url.protocol === "ws:" &&
            (url.hostname === "localhost" || url.hostname === "127.0.0.1");

        if (url.protocol !== "wss:" && !localDevelopment) return null;
        if (url.username || url.password || url.search || url.hash) return null;

        return url.toString();
    } catch {
        return null;
    }
}
