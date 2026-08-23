export const MAXIMUM_BODY_BYTES = 16 * 1024;

const SERVER_ID_PATTERN = /^[a-z0-9_-]{3,64}$/;
const STEAM_ID_PATTERN = /^[0-9]{1,20}$/;

export type ConnectionType = "Direct" | "Steam";

export type Heartbeat = {
  serverId: string;
  name: string;
  region: string;
  mode: string;
  connectionType: ConnectionType;
  address: string | null;
  port: number | null;
  steamServerId: string | null;
  modVersion: string;
  passwordRequired: boolean;
  connectedPlayers: number;
  maxPlayers: number;
};

export type HeartbeatStore = (
  heartbeat: Heartbeat,
  token: string,
) => Promise<"accepted" | "rejected" | "failed">;

export function createServerHeartbeatHandler(
  storeHeartbeat: HeartbeatStore,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "PUT") {
      return json(
        { error: "method_not_allowed" },
        405,
        { allow: "PUT" },
      );
    }

    const suppliedToken = readBearerToken(request);

    if (suppliedToken === null) {
      return json({ error: "unauthorized" }, 401);
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAXIMUM_BODY_BYTES
    ) {
      return json({ error: "request_too_large" }, 413);
    }

    let raw: unknown;

    try {
      const text = await request.text();

      if (new TextEncoder().encode(text).byteLength > MAXIMUM_BODY_BYTES) {
        return json({ error: "request_too_large" }, 413);
      }

      raw = JSON.parse(text);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const heartbeat = parseHeartbeat(raw);

    if (heartbeat === null) {
      return json({ error: "invalid_heartbeat" }, 400);
    }

    const result = await storeHeartbeat(heartbeat, suppliedToken);

    if (result === "rejected") {
      return json({ error: "unauthorized" }, 401);
    }

    if (result === "failed") {
      return json({ error: "storage_failed" }, 500);
    }

    return json({
      accepted: true,
      serverId: heartbeat.serverId,
    });
  };
}

export function parseHeartbeat(value: unknown): Heartbeat | null {
  if (!isRecord(value)) return null;

  const serverId = readString(value.serverId, 3, 64);
  const name = readString(value.name, 1, 80);
  const region = readString(value.region, 1, 40);
  const mode = readString(value.mode, 1, 40);
  const modVersion = readString(value.modVersion, 1, 80);
  const connectionType = parseConnectionType(value.connectionType);
  const address = readNullableString(value.address, 255);
  const port = readNullableInteger(value.port, 1, 65_535);
  const steamServerId = parseSteamServerId(value.steamServerId);
  const connectedPlayers = readInteger(value.connectedPlayers, 0, 1_000);
  const maxPlayers = readInteger(value.maxPlayers, 1, 1_000);

  if (
    serverId === null ||
    !SERVER_ID_PATTERN.test(serverId) ||
    name === null ||
    region === null ||
    mode === null ||
    modVersion === null ||
    connectionType === null ||
    address === undefined ||
    port === undefined ||
    steamServerId === undefined ||
    connectedPlayers === null ||
    maxPlayers === null ||
    connectedPlayers > maxPlayers ||
    typeof value.passwordRequired !== "boolean"
  ) {
    return null;
  }

  if (
    connectionType === "Direct" &&
    (address === null || port === null || steamServerId !== null)
  ) {
    return null;
  }

  if (connectionType === "Steam" && steamServerId === null) {
    return null;
  }

  return {
    serverId,
    name,
    region,
    mode,
    connectionType,
    address,
    port,
    steamServerId,
    modVersion,
    passwordRequired: value.passwordRequired,
    connectedPlayers,
    maxPlayers,
  };
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function parseConnectionType(value: unknown): ConnectionType | null {
  if (typeof value !== "string") return null;

  switch (value.toLowerCase()) {
    case "direct":
      return "Direct";
    case "steam":
      return "Steam";
    default:
      return null;
  }
}

function parseSteamServerId(value: unknown): string | null | undefined {
  if (value === null || value === 0 || value === "0") return null;

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) return undefined;
    return String(value);
  }

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return STEAM_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

function readString(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length >= minimum && trimmed.length <= maximum
    ? trimmed
    : null;
}

function readNullableString(
  value: unknown,
  maximum: number,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return readString(value, 1, maximum) ?? undefined;
}

function readInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return null;
  }

  return value;
}

function readNullableInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number") return undefined;
  return readInteger(value, minimum, maximum) ?? undefined;
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
