export type ServerStatus = "Online" | "Full" | "Offline";

export type CoopServer = {
    id: string;
    server: string;
    region: string;
    mode: string;
    warriors: number;
    maxWarriors: number;
    ping: number | null;
    status: ServerStatus;
};