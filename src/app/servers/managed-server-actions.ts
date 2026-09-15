"use server";

import {
    MyServersApiError,
    requestMyServerOperation,
    type MyServerOperation,
} from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPERATIONS = new Set<MyServerOperation>(["start", "stop", "restart-game"]);

export type ManagedServerActionResult = { ok: boolean; message: string };

export async function operateManagedServer(input: unknown): Promise<ManagedServerActionResult> {
    const parsed = parseOperation(input);
    if (parsed === null) return { ok: false, message: "The server operation is invalid." };

    let accessToken: string | null = null;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(),
            supabase.auth.getSession(),
        ]);
        if (userData.user === null) {
            return { ok: false, message: "Please sign in again before controlling this server." };
        }
        accessToken = sessionData.session?.access_token ?? null;
    } catch {
        return { ok: false, message: "Your authenticated server session is unavailable." };
    }
    if (accessToken === null) {
        return { ok: false, message: "Please sign in again before controlling this server." };
    }

    try {
        await requestMyServerOperation(accessToken, parsed);
        revalidatePath("/servers");
        return { ok: true, message: `${operationLabel(parsed.action)} command exited successfully (code 0). This does not confirm game readiness.` };
    } catch (error) {
        revalidatePath("/servers");
        const code = error instanceof MyServersApiError ? error.code : "operation_failed";
        if (code === "server_not_found") {
            return { ok: false, message: "This server is unavailable or your access was removed." };
        }
        if (code === "container_command_failed" && error instanceof MyServersApiError) {
            return { ok: false, message: error.message };
        }
        return { ok: false, message: "The command could not be confirmed. It may have executed. Refresh server status before sending another command." };
    }
}

function parseOperation(value: unknown): {
    serverId: string;
    action: MyServerOperation;
} | null {
    if (!isRecord(value) || !hasExactKeys(value, ["action", "serverId"])) return null;
    if (typeof value.serverId !== "string" || !SERVER_ID.test(value.serverId)) return null;
    if (typeof value.action !== "string" || !OPERATIONS.has(value.action as MyServerOperation)) return null;
    return {
        serverId: value.serverId,
        action: value.action as MyServerOperation,
    };
}

function operationLabel(action: MyServerOperation) {
    switch (action) {
        case "start": return "Start";
        case "stop": return "Stop";
        case "restart-game": return "Restart";
    }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
