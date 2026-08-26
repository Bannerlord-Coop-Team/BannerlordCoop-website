import { hasAdminAccess } from "@/app/lib/auth/access";
import { requestControlPlaneAdmin, ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { NextResponse } from "next/server";

const MAXIMUM_REQUEST_BYTES = 64 * 1024;

export async function POST(request: Request) {
    const supabase = await getSupabaseServerClient();
    const [{ data: userData }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
    ]);
    if (!userData.user || !sessionData.session?.access_token) {
        return errorResponse(401, "unauthenticated", "Authentication is required.");
    }
    if (!hasAdminAccess(userData.user)) {
        return errorResponse(403, "forbidden", "Administrator access is required.");
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAXIMUM_REQUEST_BYTES) {
        return errorResponse(413, "request_too_large", "The request is too large.");
    }
    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        return errorResponse(400, "invalid_request", "The request is invalid.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return errorResponse(400, "invalid_request", "The request is invalid.");
    }
    const record = body as Record<string, unknown>;
    if (
        record.version !== 1
        || typeof record.requestId !== "string"
        || typeof record.operation !== "string"
        || record.operation.length > 64
    ) return errorResponse(400, "invalid_request", "The request is invalid.");
    try {
        const result = await requestControlPlaneAdmin({
            accessToken: sessionData.session.access_token,
            requestId: record.requestId,
            operation: record.operation,
            ...(Object.hasOwn(record, "input") ? { input: record.input } : {}),
        });
        return NextResponse.json(
            { version: 1, requestId: record.requestId, ok: true, result },
            { headers: { "cache-control": "no-store" } },
        );
    } catch (error) {
        const safe = error instanceof ControlPlaneAdminError
            ? error
            : new ControlPlaneAdminError("control_plane_unavailable", "The control plane request failed.", true);
        return NextResponse.json(
            {
                version: 1,
                requestId: record.requestId,
                ok: false,
                error: { code: safe.code, message: safe.message, retryable: safe.retryable },
            },
            { status: safe.code === "forbidden" ? 403 : 409, headers: { "cache-control": "no-store" } },
        );
    }
}

function errorResponse(status: number, code: string, message: string) {
    return NextResponse.json(
        { ok: false, error: { code, message, retryable: false } },
        { status, headers: { "cache-control": "no-store" } },
    );
}
