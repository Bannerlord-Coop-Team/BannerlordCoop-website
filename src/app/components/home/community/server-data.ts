import "server-only";

import type { CoopServer } from "@/app/components/utils/types/server.types";
import { createClient } from "@supabase/supabase-js";

const ONLINE_WINDOW_MILLISECONDS = 90_000;

type CommunityServerRow = {
    id: string;
    name: string;
    region: string;
    mode: string;
    connected_players: number;
    max_players: number;
};

export type CommunityServerData = {
    playersOnline: number | null;
    dedicatedServersCount: number | null;
    platformReach: number | null;
    servers: CoopServer[];
    generatedAt: string | null;
};

const unavailableData: CommunityServerData = {
    playersOnline: null,
    dedicatedServersCount: null,
    platformReach: null,
    servers: [],
    generatedAt: null,
};

export async function getCommunityServerData(): Promise<CommunityServerData> {
    try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

        if (!url || !publishableKey) return unavailableData;

        const supabase = createClient(url, publishableKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        });
        const activeAfter = new Date(
            Date.now() - ONLINE_WINDOW_MILLISECONDS,
        ).toISOString();

        const [serversResult, platformResult] = await Promise.all([
            supabase
                .from("community_servers")
                .select(
                    "id, name, region, mode, connected_players, max_players",
                )
                .eq("public", true)
                .eq("enabled", true)
                .gte("last_seen_at", activeAfter)
                .order("connected_players", { ascending: false })
                .order("name", { ascending: true }),
            supabase
                .from("platform_statistics")
                .select("value"),
        ]);

        if (serversResult.error) {
            console.error(
                "Could not load community servers",
                serversResult.error,
            );
            return unavailableData;
        }

        if (platformResult.error) {
            console.error(
                "Could not load platform statistics",
                platformResult.error,
            );
        }

        const servers = (
            (serversResult.data ?? []) as CommunityServerRow[]
        ).map(toCoopServer);
        const platformReach = platformResult.error
            ? null
            : sumPlatformStatistics(platformResult.data ?? []);

        return {
            playersOnline: servers.reduce(
                (total, server) => total + server.warriors,
                0,
            ),
            dedicatedServersCount: servers.length,
            platformReach,
            servers,
            generatedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.error("Community server data is unavailable", error);
        return unavailableData;
    }
}

function sumPlatformStatistics(
    rows: { value: unknown }[],
): number | null {
    if (rows.length === 0) return null;

    let total = 0;

    for (const row of rows) {
        const value = parseNonNegativeInteger(row.value);
        if (value === null || total > Number.MAX_SAFE_INTEGER - value) {
            return null;
        }

        total += value;
    }

    return total;
}

function parseNonNegativeInteger(value: unknown): number | null {
    if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
    ) {
        return value;
    }

    if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }

    return null;
}

function toCoopServer(row: CommunityServerRow): CoopServer {
    const warriors = Math.max(0, row.connected_players);
    const maxWarriors = Math.max(1, row.max_players);

    return {
        id: row.id,
        server: row.name,
        region: row.region,
        mode: row.mode,
        warriors,
        maxWarriors,
        ping: null,
        status: warriors >= maxWarriors ? "Full" : "Online",
    };
}