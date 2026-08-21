const STEAM_DETAILS_URL =
    "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

const STEAM_WORKSHOP_ITEM_ID = "3770450698";

const STEAM_WORKSHOP_URL =
    `https://steamcommunity.com/sharedfiles/filedetails/?id=${STEAM_WORKSHOP_ITEM_ID}`;

type SteamPublishedFile = {
  result?: number;
  publishedfileid?: string;
  subscriptions?: number;
};

type SteamPublishedFileResponse = {
  response?: {
    result?: number;
    resultcount?: number;
    publishedfiledetails?: SteamPublishedFile[];
  };
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
  const serviceRoleKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
  );

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
        "Supabase function environment is incomplete",
    );

    return json(
        { error: "server_not_configured" },
        500,
    );
  }

  try {
    const subscriptions =
        await getSteamWorkshopSubscriptions();

    const measuredAt = new Date().toISOString();

    const response = await fetch(
        `${supabaseUrl}/rest/v1/platform_statistics?on_conflict=platform`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            "content-type":
                "application/json; charset=utf-8",
            prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify({
            platform: "steam",
            metric: "current_subscribers",
            value: subscriptions,
            source_url: STEAM_WORKSHOP_URL,
            measured_at: measuredAt,
            updated_at: measuredAt,
          }),
        },
    );

    if (!response.ok) {
      const errorBody = await response.text();

      console.error(
          "Could not save Steam statistics",
          {
            status: response.status,
            body: errorBody,
          },
      );

      return json({ error: "storage_failed" }, 500);
    }

    return json({
      synced: true,
      platform: "steam",
      metric: "current_subscribers",
      value: subscriptions,
      measuredAt,
    });
  } catch (error) {
    console.error(
        "Could not synchronize Steam statistics",
        error,
    );

    return json({ error: "steam_sync_failed" }, 502);
  }
});

async function getSteamWorkshopSubscriptions():
    Promise<number> {
  const body = new URLSearchParams({
    itemcount: "1",
    "publishedfileids[0]": STEAM_WORKSHOP_ITEM_ID,
  });

  const response = await fetch(STEAM_DETAILS_URL, {
    method: "POST",
    headers: {
      "content-type":
          "application/x-www-form-urlencoded",
      "user-agent":
          "BannerlordCoop-PlatformStatistics/1.0",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
        `Steam returned HTTP ${response.status}`,
    );
  }

  const value: unknown = await response.json();
  const details = parseSteamResponse(value);

  if (details === null) {
    throw new Error(
        "Steam returned an invalid Workshop response",
    );
  }

  return details.subscriptions;
}

function parseSteamResponse(
    value: unknown,
): Required<
    Pick<
        SteamPublishedFile,
        "publishedfileid" | "subscriptions"
    >
> | null {
  if (!isRecord(value)) return null;

  const response = value.response;
  if (!isRecord(response)) return null;

  const publishedFileDetails =
      response.publishedfiledetails;

  if (
      !Array.isArray(publishedFileDetails) ||
      publishedFileDetails.length !== 1
  ) {
    return null;
  }

  const details = publishedFileDetails[0];
  if (!isRecord(details)) return null;

  if (
      details.publishedfileid !==
      STEAM_WORKSHOP_ITEM_ID
  ) {
    return null;
  }

  if (
      typeof details.subscriptions !== "number" ||
      !Number.isSafeInteger(details.subscriptions) ||
      details.subscriptions < 0
  ) {
    return null;
  }

  return {
    publishedfileid: details.publishedfileid,
    subscriptions: details.subscriptions,
  };
}

function readBearerToken(
    request: Request,
): string | null {
  const authorization =
      request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization
      .slice("Bearer ".length)
      .trim();

  return token.length > 0 ? token : null;
}

function constantTimeEqual(
    left: string,
    right: string,
): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  const length = Math.max(
      leftBytes.length,
      rightBytes.length,
  );

  let difference =
      leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index++) {
    difference |=
        (leftBytes[index] ?? 0) ^
        (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function isRecord(
    value: unknown,
): value is Record<string, unknown> {
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
      "content-type":
          "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...additionalHeaders,
    },
  });
}