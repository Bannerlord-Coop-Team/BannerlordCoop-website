"use server";

import {
    MyServersApiError,
    requestMyServerOperation,
    type MyServerOperation,
} from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const OPERATIONS = new Set<MyServerOperation>(["start", "stop", "restart-game"]);

export type ManagedServerActionResult =
    | { ok: true; message: string; jobId: string }
    | { ok: false; message: string };

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
        const { requestId, ...operation } = parsed;
        const result = await requestMyServerOperation(accessToken, operation, requestId);
        revalidatePath("/servers");
        return {
            ok: true,
            message: result.outcome === "existing"
                ? "That server operation is already in progress."
                : `${operationLabel(parsed.action)} request accepted.`,
            jobId: result.jobId,
        };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "operation_failed";
        console.error("Managed server operation failed", { code });
        if (code === "stale_interaction") {
            revalidatePath("/servers");
            return { ok: false, message: "The server state changed. Refresh and try again." };
        }
        if (code === "server_not_found") {
            return { ok: false, message: "This server is unavailable or your access was removed." };
        }
        if (code === "operation_in_progress") {
            revalidatePath("/servers");
            return { ok: false, message: "Another server operation is in progress. Wait for it to finish and try again." };
        }
        if (code === "operation_unavailable") {
            revalidatePath("/servers");
            return { ok: false, message: "That operation is not available in the server's current state." };
        }
        if (code === "rate_limited" || code === "busy") {
            return { ok: false, message: "Too many requests were submitted. Please wait and try again." };
        }
        return { ok: false, message: "The server operation could not be submitted right now." };
    }
}

function parseOperation(value: unknown): {
    serverId: string;
    action: MyServerOperation;
    expectedUpdatedAt: string;
    requestId: string;
} | null {
    if (!isRecord(value) || !hasExactKeys(value, ["action", "expectedUpdatedAt", "requestId", "serverId"])) return null;
    if (typeof value.serverId !== "string" || !SERVER_ID.test(value.serverId)) return null;
    if (typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) return null;
    if (typeof value.action !== "string" || !OPERATIONS.has(value.action as MyServerOperation)) return null;
    if (
        typeof value.expectedUpdatedAt !== "string"
        || value.expectedUpdatedAt.length > 64
        || !ISO_TIMESTAMP.test(value.expectedUpdatedAt)
        || !Number.isFinite(Date.parse(value.expectedUpdatedAt))
    ) return null;
    return {
        serverId: value.serverId,
        action: value.action as MyServerOperation,
        expectedUpdatedAt: value.expectedUpdatedAt,
        requestId: value.requestId,
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
