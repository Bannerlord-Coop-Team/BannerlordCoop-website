"use server";

import {
    MyServersApiError,
    requestMyServerOperation,
    requestMyServerUpdate,
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
        if (parsed.action === "update-now") {
            const update = await requestMyServerUpdate(accessToken, {
                serverId: parsed.serverId,
                expectedUpdatedAt: parsed.expectedUpdatedAt,
            }, crypto.randomUUID());
            revalidatePath("/servers");
            return { ok: true, message: update.outcome === "existing"
                ? "An update is already queued for this server."
                : "Update queued. A backup will be taken before the selected release is installed." };
        } else {
            await requestMyServerOperation(accessToken, parsed);
        }
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
        if (parsed.action === "update-now") {
            if (code === "stale_interaction") {
                return { ok: false, message: "Server status changed. Refresh the page, then try Update now again." };
            }
            if (code === "no_update_available") {
                return { ok: false, message: "This server already has its selected release." };
            }
            if (code === "validated_build_unavailable") {
                return { ok: false, message: "No validated release is currently available for this server." };
            }
        }
        return { ok: false, message: "The command could not be confirmed. It may have executed. Refresh server status before sending another command." };
    }
}

function parseOperation(value: unknown): {
    serverId: string;
    action: MyServerOperation;
} | {
    serverId: string;
    action: "update-now";
    expectedUpdatedAt: string;
} | null {
    if (!isRecord(value) || typeof value.action !== "string") return null;
    if (typeof value.serverId !== "string" || !SERVER_ID.test(value.serverId)) return null;
    if (value.action === "update-now") {
        if (!hasExactKeys(value, ["action", "expectedUpdatedAt", "serverId"])) return null;
        if (typeof value.expectedUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.expectedUpdatedAt)) return null;
        return { serverId: value.serverId, action: value.action, expectedUpdatedAt: value.expectedUpdatedAt };
    }
    if (!hasExactKeys(value, ["action", "serverId"])) return null;
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
