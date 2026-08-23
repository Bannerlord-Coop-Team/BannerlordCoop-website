import { assertEquals } from "jsr:@std/assert@1";
import {
  createServerHeartbeatHandler,
  type Heartbeat,
  parseHeartbeat,
} from "../functions/_shared/server-heartbeat.ts";

const DIRECT_PAYLOAD = {
  serverId: "b77e175c-0495-462b-91e7-8c3d3bc32f33",
  name: "Bannerlord Coop Test Server",
  region: "us-east",
  mode: "campaign",
  connectionType: "direct",
  address: "203.0.113.10",
  port: 4200,
  steamServerId: 0,
  modVersion: "0.1.3",
  passwordRequired: false,
  connectedPlayers: 0,
  maxPlayers: 8,
};

Deno.test("accepts and normalizes a direct heartbeat", () => {
  assertEquals(parseHeartbeat(DIRECT_PAYLOAD), {
    ...DIRECT_PAYLOAD,
    connectionType: "Direct",
    steamServerId: null,
  });
});

Deno.test("accepts and normalizes a Steam heartbeat", () => {
  assertEquals(
    parseHeartbeat({
      ...DIRECT_PAYLOAD,
      connectionType: "steam",
      address: null,
      port: null,
      steamServerId: "76561198000000000",
    }),
    {
      ...DIRECT_PAYLOAD,
      connectionType: "Steam",
      address: null,
      port: null,
      steamServerId: "76561198000000000",
    },
  );
});

Deno.test("rejects malformed heartbeat transport metadata", () => {
  assertEquals(
    parseHeartbeat({
      ...DIRECT_PAYLOAD,
      address: null,
    }),
    null,
  );
  assertEquals(
    parseHeartbeat({
      ...DIRECT_PAYLOAD,
      connectionType: "steam",
      steamServerId: 0,
    }),
    null,
  );
  assertEquals(
    parseHeartbeat({
      ...DIRECT_PAYLOAD,
      connectionType: "gog",
    }),
    null,
  );
});

Deno.test("enforces heartbeat player and port boundaries", () => {
  assertEquals(
    parseHeartbeat({
      ...DIRECT_PAYLOAD,
      port: 1,
      maxPlayers: 1_000,
      connectedPlayers: 1_000,
    })?.port,
    1,
  );
  assertEquals(
    parseHeartbeat({
      ...DIRECT_PAYLOAD,
      port: 65_535,
    })?.port,
    65_535,
  );
  assertEquals(parseHeartbeat({ ...DIRECT_PAYLOAD, port: 0 }), null);
  assertEquals(parseHeartbeat({ ...DIRECT_PAYLOAD, port: 65_536 }), null);
  assertEquals(
    parseHeartbeat({
      ...DIRECT_PAYLOAD,
      connectedPlayers: 9,
      maxPlayers: 8,
    }),
    null,
  );
  assertEquals(parseHeartbeat({ ...DIRECT_PAYLOAD, maxPlayers: 1_001 }), null);
});

Deno.test("returns 401 for missing or rejected authentication", async () => {
  const missingHandler = createServerHeartbeatHandler(() =>
    Promise.resolve("accepted")
  );
  const missingResponse = await missingHandler(request(DIRECT_PAYLOAD));

  assertEquals(missingResponse.status, 401);
  assertEquals(await missingResponse.json(), { error: "unauthorized" });

  const rejectedHandler = createServerHeartbeatHandler(() =>
    Promise.resolve("rejected")
  );
  const rejectedResponse = await rejectedHandler(
    request(DIRECT_PAYLOAD, "wrong-token"),
  );

  assertEquals(rejectedResponse.status, 401);
  assertEquals(await rejectedResponse.json(), { error: "unauthorized" });
});

Deno.test("returns 400 for malformed payloads", async () => {
  const handler = createServerHeartbeatHandler(() =>
    Promise.resolve("accepted")
  );
  const response = await handler(request({
    ...DIRECT_PAYLOAD,
    connectedPlayers: 9,
    maxPlayers: 8,
  }, "server-token"));

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "invalid_heartbeat" });
});

Deno.test("returns 400 for invalid JSON", async () => {
  const handler = createServerHeartbeatHandler(() =>
    Promise.resolve("accepted")
  );
  const response = await handler(
    new Request(
      "https://example.test/server-heartbeat",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer server-token",
          "content-type": "application/json",
        },
        body: "{",
      },
    ),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "invalid_json" });
});

Deno.test("rejects oversized heartbeat bodies", async () => {
  const handler = createServerHeartbeatHandler(() =>
    Promise.resolve("accepted")
  );
  const response = await handler(
    new Request(
      "https://example.test/server-heartbeat",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer server-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ padding: "x".repeat(16 * 1024) }),
      },
    ),
  );

  assertEquals(response.status, 413);
  assertEquals(await response.json(), { error: "request_too_large" });
});

Deno.test("returns 405 for unsupported methods", async () => {
  const handler = createServerHeartbeatHandler(() =>
    Promise.resolve("accepted")
  );
  const response = await handler(
    new Request(
      "https://example.test/server-heartbeat",
      { method: "POST" },
    ),
  );

  assertEquals(response.status, 405);
  assertEquals(response.headers.get("allow"), "PUT");
});

Deno.test("returns 500 when heartbeat storage fails", async () => {
  const handler = createServerHeartbeatHandler(() => Promise.resolve("failed"));
  const response = await handler(request(DIRECT_PAYLOAD, "server-token"));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "storage_failed" });
});

Deno.test("passes normalized direct and Steam heartbeats to storage", async () => {
  const stored: Heartbeat[] = [];
  const handler = createServerHeartbeatHandler((heartbeat, token) => {
    assertEquals(token, "server-token");
    stored.push(heartbeat);
    return Promise.resolve("accepted");
  });

  assertEquals(
    (await handler(request(DIRECT_PAYLOAD, "server-token"))).status,
    200,
  );
  assertEquals(
    (await handler(request({
      ...DIRECT_PAYLOAD,
      connectionType: "steam",
      address: null,
      port: null,
      steamServerId: 123_456,
    }, "server-token"))).status,
    200,
  );
  assertEquals(stored.map((heartbeat) => heartbeat.connectionType), [
    "Direct",
    "Steam",
  ]);
});

Deno.test("upserts repeated heartbeats by server ID", async () => {
  const rows = new Map<string, Heartbeat>();
  const handler = createServerHeartbeatHandler((heartbeat) => {
    rows.set(heartbeat.serverId, heartbeat);
    return Promise.resolve("accepted");
  });

  await handler(request(DIRECT_PAYLOAD, "server-token"));
  await handler(request({
    ...DIRECT_PAYLOAD,
    connectedPlayers: 3,
  }, "server-token"));

  assertEquals(rows.size, 1);
  assertEquals(rows.get(DIRECT_PAYLOAD.serverId)?.connectedPlayers, 3);
});

function request(payload: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);

  return new Request("https://example.test/server-heartbeat", {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
}
