import "server-only";

import { parseConsoleServerCatalog } from "@/app/lib/console/catalog";

export type { LiveConsoleServer } from "@/app/lib/console/catalog";

// Lists explicitly configured external servers; managed servers come from authorized inventory.
export function listLiveConsoleServers() {
    return parseConsoleServerCatalog(process.env.CONSOLE_SERVER_CATALOG, []);
}

// Resolves only an operator-configured external server, never an inferred managed alias.
export function getLiveConsoleServer(serverId: string) {
    return listLiveConsoleServers().find((server) => server.id === serverId) ?? null;
}

// Reads a secure external gateway URL, allowing insecure WebSockets only for local development.
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
