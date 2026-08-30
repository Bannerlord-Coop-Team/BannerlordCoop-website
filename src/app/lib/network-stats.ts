import "server-only";

export type NetworkStats = {
    playersOnline: number | null;
    dedicatedServersCount: number | null;
    battlesFoughtTotal: number | null;
    totalDownloads: number | null;
};

type NetworkStatsResponse = {
    player_count?: unknown;
    server_count?: unknown;
    battles_fought_total?: unknown;
    total_downloads?: unknown;
};

const unavailableStats: NetworkStats = {
    playersOnline: null,
    dedicatedServersCount: null,
    battlesFoughtTotal: null,
    totalDownloads: null,
};

export async function getNetworkStats(): Promise<NetworkStats> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !publishableKey) {
        return unavailableStats;
    }

    try {
        const response = await fetch(
            `${supabaseUrl}/functions/v1/network-stats-cached`,
            {
                headers: {
                    apikey: publishableKey,
                },
                next: {
                    revalidate: 15,
                },
            },
        );

        if (!response.ok) {
            console.error(
                `Network stats request failed with status ${response.status}.`,
            );
            return unavailableStats;
        }

        const data = (await response.json()) as NetworkStatsResponse;

        return {
            playersOnline: parseCount(data.player_count),
            dedicatedServersCount: parseCount(data.server_count),
            battlesFoughtTotal: parseCount(data.battles_fought_total),
            totalDownloads: parseCount(data.total_downloads),
        };
    } catch (error) {
        console.error("Unable to retrieve network stats.", error);
        return unavailableStats;
    }
}

function parseCount(value: unknown): number | null {
    return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
        ? value
        : null;
}
