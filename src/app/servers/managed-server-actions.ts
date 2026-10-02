"use server";

import {
    MyServersApiError,
    requestMyServerOperation,
    requestMyServerUpdate,
    requestMyServerPassword,
    type MyServerOperation,
} from "@/app/lib/hosting/my-servers";
import { getMyServerStartStatus } from "@/app/lib/hosting/my-servers-server";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPERATIONS = new Set<MyServerOperation>(["start", "stop", "restart-game"]);

export type ManagedServerActionResult = { ok: boolean; message: string; operationId?: string; checkStatus?: boolean };

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
        if (parsed.action === "start") return { ok: true, message: "Server started and game readiness confirmed." };
        if (parsed.action === "stop") return { ok: true, checkStatus: true, message: "Checking whether your server has stopped…" };
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
        if (parsed.action === "start" && code === "operation_timeout"
            && error instanceof MyServersApiError && error.operationId !== undefined) {
            return { ok: true, operationId: error.operationId, message: "Start accepted. Following your server’s progress…" };
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
        if (parsed.action === "stop") return { ok: false, checkStatus: true, message: "Checking whether your server has stopped…" };
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

export async function setManagedServerPassword(input: { serverId: string; expectedUpdatedAt: string; password: string }): Promise<ManagedServerActionResult> {
    if (!input || !SERVER_ID.test(input.serverId) || typeof input.password !== "string" || input.password.length < 1 || input.password.length > 128 || typeof input.expectedUpdatedAt !== "string") return { ok: false, message: "Enter a password of 1–128 characters." };
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session) return { ok: false, message: "Sign in again to change the password." };
        const result = await requestMyServerPassword(session.access_token, input, crypto.randomUUID());
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, message: result.restartQueued ? "Password changed. A restart is queued with a player warning." : "Password changed. Use it when joining your server." };
    } catch {
        return { ok: false, message: "The change could not be confirmed. Refresh server status before trying again." };
    }
}

/** Reauthenticates each progress read; the control plane checks current server access. */
export async function readManagedServerStartStatus(serverId: string, jobId: string) {
    if (typeof serverId !== "string" || typeof jobId !== "string" || !SERVER_ID.test(serverId) || !SERVER_ID.test(jobId)) {
        return { ok: false as const, retryable: false, message: "The Start reference is invalid." };
    }
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session) return { ok: false as const, retryable: false, message: "Sign in again to follow server progress." };
        return { ok: true as const, status: await getMyServerStartStatus(session.access_token, serverId, jobId) };
    } catch (error) {
        if (error instanceof MyServersApiError && ["forbidden", "server_not_found", "unauthenticated"].includes(error.code)) {
            return { ok: false as const, retryable: false, message: "Your server access could not be confirmed. Sign in again to resume progress updates." };
        }
        return { ok: false as const, retryable: true, message: "Reconnecting to server progress… Your Start request is still being tracked." };
    }
}
