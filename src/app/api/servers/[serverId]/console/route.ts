import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { createConsoleStreamHandler } from "@/app/lib/console/stream-handler";

export const dynamic = "force-dynamic";

export const GET = createConsoleStreamHandler({
    getAuthClient: getSupabaseServerClient,
    fetch,
    randomUUID: () => crypto.randomUUID(),
    consoleOrigin: () => process.env.CONTROL_PLANE_CONSOLE_ORIGIN,
});
