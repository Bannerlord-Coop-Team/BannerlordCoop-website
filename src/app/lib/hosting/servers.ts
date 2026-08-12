import {
    hasServerFleetAccess,
    type MemberRole,
    type ServerCustomerRole,
} from "@/app/lib/auth/roles";

export type ServerPlan = "Standard" | "Premium";
export type HostedServerStatus = "Online" | "Offline";

export type HostedServerLog = {
    time: string;
    level: "INFO" | "WARN";
    message: string;
};

export type AssignedAccount = {
    id: string;
    displayName: string;
    email: string;
};

export type RestartSchedule = {
    cron: string;
    timezone: string;
    description: string;
    enabled: boolean;
};

export type HostedServer = {
    id: string;
    name: string;
    assignedAccount: AssignedAccount;
    audience: ServerCustomerRole;
    plan: ServerPlan;
    status: HostedServerStatus;
    region: string;
    location: string;
    players: number;
    maxPlayers: number;
    memory: string;
    storage: string;
    backups: string;
    node: string;
    version: string;
    restartSchedule: RestartSchedule;
    logs: HostedServerLog[];
};

export const PLACEHOLDER_SERVERS: readonly HostedServer[] = [
    {
        id: "calradia-standard-01",
        name: "Calradia Company",
        assignedAccount: {
            id: "account-demo-standard",
            displayName: "Arenicos Company",
            email: "standard.demo@bannerlordcoop.test",
        },
        audience: "Standard Server",
        plan: "Standard",
        status: "Online",
        region: "Europe",
        location: "Frankfurt, DE",
        players: 3,
        maxPlayers: 8,
        memory: "6 GB",
        storage: "25 GB NVMe",
        backups: "Daily",
        node: "eu-demo-01",
        version: "v1.2.12",
        restartSchedule: {
            cron: "0 4 * * *",
            timezone: "UTC",
            description: "Every day at 04:00 UTC",
            enabled: false,
        },
        logs: [
            { time: "12:04:18", level: "INFO", message: "Campaign state loaded successfully" },
            { time: "12:04:20", level: "INFO", message: "Listening for cooperative connections on demo port" },
            { time: "12:04:27", level: "INFO", message: "Player party joined the campaign" },
        ],
    },
    {
        id: "vlandian-premium-01",
        name: "Vlandian Vanguard",
        assignedAccount: {
            id: "account-demo-premium",
            displayName: "Derthert Vanguard",
            email: "premium.demo@bannerlordcoop.test",
        },
        audience: "Premium Server",
        plan: "Premium",
        status: "Offline",
        region: "North America",
        location: "Virginia, US",
        players: 0,
        maxPlayers: 16,
        memory: "12 GB",
        storage: "60 GB NVMe",
        backups: "Every 6 hours",
        node: "us-demo-02",
        version: "v1.2.12",
        restartSchedule: {
            cron: "0 4 * * *",
            timezone: "UTC",
            description: "Every day at 04:00 UTC",
            enabled: false,
        },
        logs: [
            { time: "09:31:02", level: "INFO", message: "World save completed" },
            { time: "09:31:04", level: "INFO", message: "All cooperative sessions closed" },
            { time: "09:31:05", level: "WARN", message: "Server stopped by account owner" },
        ],
    },
] as const;

export function getServersForRole(role: MemberRole) {
    if (hasServerFleetAccess(role)) return [...PLACEHOLDER_SERVERS];
    return PLACEHOLDER_SERVERS.filter((server) => server.audience === role);
}

export function getServerForRole(serverId: string, role: MemberRole) {
    return getServersForRole(role).find((server) => server.id === serverId);
}
