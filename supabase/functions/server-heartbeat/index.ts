import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createServerHeartbeatHandler,
  type HeartbeatStore,
} from "../_shared/server-heartbeat.ts";

function createSupabaseHeartbeatStore(): HeartbeatStore | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return async (heartbeat, token) => {
    const { data: accepted, error } = await supabase.rpc(
      "community_server_heartbeat",
      {
        heartbeat_slug: heartbeat.serverId,
        heartbeat_secret: token,
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
      return "failed";
    }

    return accepted === true ? "accepted" : "rejected";
  };
}

const heartbeatStore = createSupabaseHeartbeatStore();

if (heartbeatStore === null) {
  console.error("Supabase function environment is incomplete");
  Deno.serve(() => json({ error: "server_not_configured" }, 500));
} else {
  Deno.serve(createServerHeartbeatHandler(heartbeatStore));
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
