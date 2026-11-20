import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
  "SUPABASE_SERVICE_ROLE_KEY"
);

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is required");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

type NetworkStats = {
  server_count: number;
  player_count: number;
  battles_fought_total: number;
  total_downloads: number;
};

const TTL_MS = 15_000;

let cached: NetworkStats | null = null;
let cachedAtMs = 0;

// Prevent multiple simultaneous refreshes in the same isolate.
let refreshPromise: Promise<NetworkStats> | null = null;

async function fetchStats(): Promise<NetworkStats> {
  // Run independent queries in parallel.
  const [
    networkResult,
    battlesResult,
    platformTotalResult,
  ] = await Promise.all([
    supabase.rpc("get_network_stats"),

    supabase
      .from("battles_fought_counter")
      .select("battles_fought")
      .limit(1)
      .single(),

    supabase.rpc("get_platform_total"),
  ]);

  // 1) Network stats
  if (networkResult.error) {
    throw networkResult.error;
  }

  const networkRow = Array.isArray(networkResult.data)
    ? networkResult.data[0]
    : networkResult.data;

  const server_count = Number(
    networkRow?.server_count ?? 0
  );

  const player_count = Number(
    networkRow?.player_count ?? 0
  );

  // 2) Battles fought total
  // If the table is empty or unavailable, default to 0.
  const battles_fought_total =
    battlesResult.error
      ? 0
      : Number(
          (battlesResult.data as any)?.battles_fought ?? 0
        );

  // 3) Platform statistics total
  if (platformTotalResult.error) {
    throw platformTotalResult.error;
  }

  // Scalar SQL functions normally return the scalar directly.
  const total_downloads = Number(
    platformTotalResult.data ?? 0
  );

  return {
    server_count,
    player_count,
    battles_fought_total,
    total_downloads,
  };
}

async function getStats(): Promise<NetworkStats> {
  const now = Date.now();

  if (cached && now - cachedAtMs < TTL_MS) {
    return cached;
  }

  // Another request is already refreshing this isolate.
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = fetchStats();

  try {
    const next = await refreshPromise;

    cached = next;
    cachedAtMs = Date.now();

    return next;
  } finally {
    refreshPromise = null;
  }
}

Deno.serve(async () => {
  try {
    const stats = await getStats();

    return Response.json(
      {
        ...stats,
        cache_ttl_ms: TTL_MS,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15",
        },
      }
    );
  } catch (error) {
    console.error(
      "Failed to retrieve network stats:",
      error
    );

    // If the DB temporarily fails but we have an older result,
    // serving stale stats is better than showing nothing.
    if (cached) {
      return Response.json(
        {
          ...cached,
          stale: true,
        },
        {
          headers: {
            "Cache-Control": "public, max-age=5",
          },
        }
      );
    }

    return Response.json(
      {
        error: "Failed to retrieve network statistics",
      },
      {
        status: 500,
      }
    );
  }
});
