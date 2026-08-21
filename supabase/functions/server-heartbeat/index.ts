import { createClient } from "jsr:@supabase/supabase-js@2";

const SERVER_ID_PATTERN = /^[a-z0-9_-]{3,64}$/;
const STEAM_ID_PATTERN = /^[0-9]{1,20}$/;
const MAXIMUM_BODY_BYTES = 16 * 1024;

type ConnectionType = "Direct" | "Steam";

type Heartbeat = {
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

Deno.serve(async (request: Request): Promise<Response> => {
    if (request.method !== "PUT") {
        return json(
            { error: "method_not_allowed" },
            405,
            { allow: "PUT" },
        );
    }

    const expectedToken = Deno.env.get("SERVER_HEARTBEAT_TOKEN");
    const suppliedToken = readBearerToken(request);

    if (
        !expectedToken ||
        !suppliedToken ||
        !constantTimeEqual(suppliedToken, expectedToken)
    ) {
        return json({ error: "unauthorized" }, 401);
    }

    const contentLength = Number(
        request.headers.get("content-length") ?? "0",
    );

    if (
        Number.isFinite(contentLength) &&
        contentLength > MAXIMUM_BODY_BYTES
    ) {
        return json({ error: "request_too_large" }, 413);
    }

    let raw: unknown;

    try {
        const text = await request.text();

        if (
            new TextEncoder().encode(text).byteLength >
            MAXIMUM_BODY_BYTES
        ) {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
        console.error("Supabase function environment is incomplete");
        return json({ error: "server_not_configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    const { data: accepted, error } = await supabase.rpc(
        "community_server_heartbeat",
        {
            heartbeat_slug: heartbeat.serverId,
            heartbeat_secret: suppliedToken,
            heartbeat_name: heartbeat.name,
            heartbeat_region: heartbeat.region,
            heartbeat_mode: heartbeat.mode,
            heartbeat_connection_type: heartbeat.connectionType,
            heartbeat_address: heartbeat.address,
            heartbeat_port: heartbeat.port,
            heartbeat_steam_server_id: heartbeat.steamServerId,
            heartbeat_mod_version: heartbeat.modVersion,
            heartbeat_password_required: heartbeat.passwordRequired,
            heartbeat_connected_players: heartbeat.connectedPlayers,
            heartbeat_max_players: heartbeat.maxPlayers,
        },
    );

    if (error) {
        console.error("Server heartbeat RPC failed", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
        });

        return json({ error: "storage_failed" }, 500);
    }

    if (accepted !== true) {
        return json({ error: "invalid_server_credentials" }, 401);
    }

    return json({
        accepted: true,
        serverId: heartbeat.serverId,
    });
});

function parseHeartbeat(value: unknown): Heartbeat | null {
    if (!isRecord(value)) return null;

    const serverId = readString(value.serverId, 3, 64);
    const name = readString(value.name, 1, 80);
    const region = readString(value.region, 1, 40);
    const mode = readString(value.mode, 1, 40);
    const modVersion = readString(value.modVersion, 1, 80);

    if (
        serverId === null ||
        !SERVER_ID_PATTERN.test(serverId) ||
        name === null ||
        region === null ||
        mode === null ||
        modVersion === null
    ) {
        return null;
    }

    if (
        value.connectionType !== "Direct" &&
        value.connectionType !== "Steam"
    ) {
        return null;
    }

    const address = readNullableString(value.address, 255);
    const port = readNullableInteger(value.port, 1, 65_535);
    const steamServerId = readNullableString(value.steamServerId, 20);
    const connectedPlayers = readInteger(value.connectedPlayers, 0, 1_000);
    const maxPlayers = readInteger(value.maxPlayers, 1, 1_000);

    if (
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
        steamServerId !== null &&
        !STEAM_ID_PATTERN.test(steamServerId)
    ) {
        return null;
    }

    if (
        value.connectionType === "Direct" &&
        (address === null || port === null)
    ) {
        return null;
    }

    if (
        value.connectionType === "Steam" &&
        steamServerId === null
    ) {
        return null;
    }

    return {
        serverId,
        name,
        region,
        mode,
        connectionType: value.connectionType,
        address,
        port,
        steamServerId,
        modVersion,
        passwordRequired: value.passwordRequired,
        connectedPlayers,
        maxPlayers,
    };
}

function readBearerToken(request: Request): string | null {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        return null;
    }

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
        difference |=
            (leftBytes[index] ?? 0) ^
            (rightBytes[index] ?? 0);
    }

    return difference === 0;
}

function readString(
    value: unknown,
    minimum: number,
    maximum: number,
): string | null {
    if (typeof value !== "string") return null;

    const trimmed = value.trim();

    if (trimmed.length < minimum || trimmed.length > maximum) {
        return null;
    }

    return trimmed;
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
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...additionalHeaders,
        },
    });
}