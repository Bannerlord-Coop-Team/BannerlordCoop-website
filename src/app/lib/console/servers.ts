import "server-only";

export const LIVE_CONSOLE_SERVER_ID = "bannerlord-live-15-204-120-17";

export type LiveConsoleServer = {
    id: string;
    name: string;
    address: string;
    nodeId: string;
    provider: string;
};

const LIVE_CONSOLE_SERVERS: readonly LiveConsoleServer[] = [
    {
        id: LIVE_CONSOLE_SERVER_ID,
        name: "Bannerlord Live Server",
        address: "15.204.120.17",
        nodeId: "vps-15-204-120-17",
        provider: "External VPS",
    },
];

export function listLiveConsoleServers() {
    return LIVE_CONSOLE_SERVERS;
}

export function getLiveConsoleServer(serverId: string) {
    return LIVE_CONSOLE_SERVERS.find((server) => server.id === serverId) ?? null;
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
