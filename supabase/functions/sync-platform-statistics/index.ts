const STEAM_DETAILS_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const STEAM_WORKSHOP_ITEM_ID = "3770450698";
const STEAM_WORKSHOP_URL =
  `https://steamcommunity.com/sharedfiles/filedetails/?id=${STEAM_WORKSHOP_ITEM_ID}`;
const MODDB_DOWNLOADS_URL =
  "https://www.moddb.com/mods/bannerlord-coop/downloads";
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const USER_AGENT = "BannerlordCoop-PlatformStatistics/1.0";

type Platform = "steam" | "nexus" | "moddb";
type PlatformMetric =
  | "current_subscribers"
  | "unique_downloads"
  | "total_downloads";

type PlatformStatistic = {
  platform: Platform;
  metric: PlatformMetric;
  value: number;
  sourceUrl: string;
  measuredAt: string;
};

type SyncResult =
  | {
    platform: Platform;
    status: "updated";
    value: number;
  }
  | {
    platform: Platform;
    status: "skipped" | "failed";
    reason: string;
  };

type SteamPublishedFile = {
  publishedfileid: string;
  subscriptions: number;
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return json(
      { error: "method_not_allowed" },
      405,
      { allow: "POST" },
    );
  }

  const expectedToken = Deno.env.get("PLATFORM_SYNC_TOKEN");
  const suppliedToken = readBearerToken(request);

  if (
    !expectedToken ||
    !suppliedToken ||
    !constantTimeEqual(suppliedToken, expectedToken)
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase function environment is incomplete");
    return json({ error: "server_not_configured" }, 500);
  }

  const results: SyncResult[] = [];

  await synchronizePlatform(
    "steam",
    getSteamStatistic,
    supabaseUrl,
    serviceRoleKey,
    results,
  );

  const nexusConfiguration = getNexusConfiguration();

  if (nexusConfiguration === null) {
    results.push({
      platform: "nexus",
      status: "skipped",
      reason: "Nexus configuration is not available",
    });
  } else {
    await synchronizePlatform(
      "nexus",
      () => getNexusStatistic(nexusConfiguration),
      supabaseUrl,
      serviceRoleKey,
      results,
    );
  }

  await synchronizePlatform(
    "moddb",
    getModDbStatistic,
    supabaseUrl,
    serviceRoleKey,
    results,
  );

  const updatedCount = results.filter(
    (result) => result.status === "updated",
  ).length;

  return json(
    {
      synced: updatedCount > 0,
      results,
    },
    updatedCount > 0 ? 200 : 502,
  );
});

async function synchronizePlatform(
  platform: Platform,
  collect: () => Promise<PlatformStatistic>,
  supabaseUrl: string,
  serviceRoleKey: string,
  results: SyncResult[],
): Promise<void> {
  try {
    const statistic = await collect();
    await storeStatistic(supabaseUrl, serviceRoleKey, statistic);

    results.push({
      platform,
      status: "updated",
      value: statistic.value,
    });
  } catch (error) {
    console.error(`Could not synchronize ${platform} statistics`, error);
    results.push({
      platform,
      status: "failed",
      reason: errorMessage(error),
    });
  }
}

async function getSteamStatistic(): Promise<PlatformStatistic> {
  const subscriptions = await getSteamWorkshopSubscriptions();

  return {
    platform: "steam",
    metric: "current_subscribers",
    value: subscriptions,
    sourceUrl: STEAM_WORKSHOP_URL,
    measuredAt: new Date().toISOString(),
  };
}

async function getSteamWorkshopSubscriptions(): Promise<number> {
  const body = new URLSearchParams({
    itemcount: "1",
    "publishedfileids[0]": STEAM_WORKSHOP_ITEM_ID,
  });
  const response = await fetch(STEAM_DETAILS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });

  if (!response.ok) {
    throw new Error(`Steam returned HTTP ${response.status}`);
  }

  const details = parseSteamResponse(await response.json());

  if (details === null) {
    throw new Error("Steam returned an invalid Workshop response");
  }

  return details.subscriptions;
}

type NexusConfiguration = {
  apiKey: string;
  gameDomain: string;
  modId: string;
};

function getNexusConfiguration(): NexusConfiguration | null {
  const apiKey = Deno.env.get("NEXUS_API_KEY")?.trim();
  const gameDomain = Deno.env.get("NEXUS_GAME_DOMAIN")?.trim();
  const modId = Deno.env.get("NEXUS_MOD_ID")?.trim();

  if (!apiKey || !gameDomain || !modId) return null;

  if (!/^[a-z0-9-]+$/.test(gameDomain)) {
    throw new Error("NEXUS_GAME_DOMAIN has an invalid format");
  }

  if (!/^[1-9][0-9]*$/.test(modId)) {
    throw new Error("NEXUS_MOD_ID has an invalid format");
  }

  return { apiKey, gameDomain, modId };
}

async function getNexusStatistic(
  configuration: NexusConfiguration,
): Promise<PlatformStatistic> {
  const endpoint =
    `https://api.nexusmods.com/v1/games/${configuration.gameDomain}/mods/${configuration.modId}.json`;
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      apikey: configuration.apiKey,
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });

  if (!response.ok) {
    throw new Error(`Nexus returned HTTP ${response.status}`);
  }

  const downloads = parseNexusUniqueDownloads(
    await response.json(),
    Number(configuration.modId),
  );

  if (downloads === null) {
    throw new Error("Nexus returned an invalid mod response");
  }

  return {
    platform: "nexus",
    metric: "unique_downloads",
    value: downloads,
    sourceUrl:
      `https://www.nexusmods.com/${configuration.gameDomain}/mods/${configuration.modId}`,
    measuredAt: new Date().toISOString(),
  };
}

async function getModDbStatistic(): Promise<PlatformStatistic> {
  const response = await fetch(MODDB_DOWNLOADS_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });

  if (!response.ok) {
    throw new Error(`ModDB returned HTTP ${response.status}`);
  }

  const downloads = parseModDbTotalDownloads(await response.text());

  if (downloads === null) {
    throw new Error("ModDB returned an unrecognized downloads page");
  }

  return {
    platform: "moddb",
    metric: "total_downloads",
    value: downloads,
    sourceUrl: MODDB_DOWNLOADS_URL,
    measuredAt: new Date().toISOString(),
  };
}

async function storeStatistic(
  supabaseUrl: string,
  serviceRoleKey: string,
  statistic: PlatformStatistic,
): Promise<void> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/platform_statistics?on_conflict=platform`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": "application/json; charset=utf-8",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        platform: statistic.platform,
        metric: statistic.metric,
        value: statistic.value,
        source_url: statistic.sourceUrl,
        measured_at: statistic.measuredAt,
        updated_at: statistic.measuredAt,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Could not store ${statistic.platform}: HTTP ${response.status}: ${body}`,
    );
  }
}

function parseSteamResponse(value: unknown): SteamPublishedFile | null {
  if (!isRecord(value) || !isRecord(value.response)) return null;

  const details = value.response.publishedfiledetails;

  if (!Array.isArray(details) || details.length !== 1) return null;

  const publishedFile = details[0];

  if (
    !isRecord(publishedFile) ||
    publishedFile.publishedfileid !== STEAM_WORKSHOP_ITEM_ID ||
    !isNonNegativeInteger(publishedFile.subscriptions)
  ) {
    return null;
  }

  return {
    publishedfileid: publishedFile.publishedfileid,
    subscriptions: publishedFile.subscriptions,
  };
}

function parseNexusUniqueDownloads(
  value: unknown,
  expectedModId: number,
): number | null {
  if (
    !isRecord(value) ||
    value.mod_id !== expectedModId ||
    !isNonNegativeInteger(value.unique_downloads)
  ) {
    return null;
  }

  return value.unique_downloads;
}

function parseModDbTotalDownloads(html: string): number | null {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(
    /\bDownloads\s+([0-9][0-9,]*)\s+Downloads Today\b/i,
  );

  if (!match) return null;

  const downloads = Number(match[1].replace(/,/g, ""));
  return isNonNegativeInteger(downloads) ? downloads : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown synchronization error";
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index++) {
    difference |= (leftBytes[index] ?? 0) ^
      (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function json(
  body: unknown,
  status = 200,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...additionalHeaders,
    },
  });
}
