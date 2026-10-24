import type { SupabaseClient } from "@supabase/supabase-js";

import { sameOriginRequest } from "@/app/lib/auth/same-origin";
import { MyServersApiError } from "./my-servers";
import type { ServerModsApi } from "./server-mods-api";
import { MODS_REFRESH_SESSION_HEADER } from "./server-mods";
import { readBoundedBytes, readBoundedText, RequestTooLargeError } from "../../../../supabase/functions/_shared/edge-http";
import {
    MAXIMUM_MODS_REQUEST_BYTES,
    MOD_UPLOAD_CHUNK_BYTES,
    isModJsonRoute,
    isModUuid,
    modRefusalFromErrorMessage,
    parseModChunkDigest,
    parseModChunkQuery,
    parseModsRequest,
    type ModsRequest,
} from "../../../../supabase/functions/_shared/server-mods-contract";

// Same-origin website routes for the Mods tab: `POST /api/servers/<id>/mods?route=<route>` and
// `PUT /api/servers/<id>/mods/chunk?uploadId=&index=`. Route handlers keep long chunk relays out of
// the page's sequential server-action queue, and refresh the Supabase session themselves.

/** Sessions this close to expiry are refreshed before relaying, matching the page middleware. */
const REFRESH_BEFORE_EXPIRY_MILLISECONDS = 5 * 60_000;
const ERROR_STATUS: Readonly<Record<string, number>> = {
    unauthenticated: 401, invalid_request: 400, mod_reserved_id: 400, mod_order_invalid: 400, server_not_found: 404, upload_not_found: 404,
    request_too_large: 413, invalid_content_type: 415, rate_limited: 429, busy: 429,
    identity_unavailable: 503, server_api_unavailable: 503, control_plane_unavailable: 503, invalid_response: 502,
};

/** The browser-facing failure: a closed code, whether an identical resend may succeed, and a module the refusal names. */
/** A refusal in the browser envelope; `issue` appears only when the control plane named one (a refused runs-on switch). */
export type ServerModsRouteError = { code: string; retryable: boolean; modId: string | null; issue?: string };

export type ServerModsRouteDependencies = Readonly<{
    getAuthClient: () => Promise<Pick<SupabaseClient, "auth">>;
    api: ServerModsApi;
    now: () => number;
}>;

type RouteContext = { params: Promise<{ serverId: string }> };

/** Builds the JSON route handler: allowlisted route key, bounded strict body bound to the path's server. */
export function createServerModsJsonHandler(dependencies: ServerModsRouteDependencies) {
    return async (request: Request, context: RouteContext): Promise<Response> => {
        const serverId = await routeServerId(request, context);
        if (serverId === null) return new Response("Not found.", { status: 404 });
        const url = new URL(request.url);
        const route = url.searchParams.getAll("route");
        if ([...url.searchParams.keys()].length !== 1 || route.length !== 1 || !isModJsonRoute(route[0])) return new Response("Not found.", { status: 404 });
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return failure("invalid_content_type", false);
        let parsed: ModsRequest;
        try {
            parsed = parseModsRequest(route[0], JSON.parse(await readBoundedText(request, MAXIMUM_MODS_REQUEST_BYTES)));
        } catch (error) {
            return failure(error instanceof RequestTooLargeError ? "request_too_large" : "invalid_request", false);
        }
        if ("serverId" in parsed.body && parsed.body.serverId.toLowerCase() !== serverId.toLowerCase()) return failure("invalid_request", false);
        const token = await currentAccessToken(dependencies, request);
        if (token === null) return failure("unauthenticated", false);
        return relay(() => dependencies.api.request(token, parsed));
    };
}

/** Builds the chunk route handler: exact query, digest header, octet-stream body read whole within 8 MiB. */
export function createServerModChunkHandler(dependencies: ServerModsRouteDependencies) {
    return async (request: Request, context: RouteContext): Promise<Response> => {
        if (await routeServerId(request, context) === null) return new Response("Not found.", { status: 404 });
        let target: { uploadId: string; index: number };
        let sha256: string;
        try {
            const url = new URL(request.url);
            if ([...url.searchParams.keys()].length !== 2) throw new Error("Unexpected query");
            target = parseModChunkQuery(url.searchParams.get("uploadId"), url.searchParams.get("index"));
            sha256 = parseModChunkDigest(request.headers.get("x-chunk-sha256"));
        } catch {
            return failure("invalid_request", false);
        }
        if (request.headers.get("content-type")?.toLowerCase().split(";")[0]?.trim() !== "application/octet-stream") return failure("invalid_content_type", false);
        let bytes: Uint8Array<ArrayBuffer>;
        try {
            bytes = await readBoundedBytes(request, MOD_UPLOAD_CHUNK_BYTES);
        } catch (error) {
            return failure(error instanceof RequestTooLargeError ? "request_too_large" : "invalid_request", false);
        }
        if (bytes.byteLength === 0) return failure("invalid_request", false);
        const token = await currentAccessToken(dependencies, request);
        if (token === null) return failure("unauthenticated", false);
        try {
            return await relay(() => dependencies.api.putChunk(token, { ...target, sha256, bytes }));
        } finally {
            bytes.fill(0);
        }
    };
}

/** Returns the path's server UUID for a same-origin request, or null. */
async function routeServerId(request: Request, context: RouteContext): Promise<string | null> {
    if (!sameOriginRequest(request)) return null;
    const { serverId } = await context.params;
    return isModUuid(serverId) ? serverId : null;
}

/**
 * Returns the caller's verified access token, refreshing a session near expiry (or on the browser's one
 * forced retry after a 401); null when the user, session or forced refresh is unavailable.
 */
async function currentAccessToken(dependencies: ServerModsRouteDependencies, request: Request): Promise<string | null> {
    const forceRefresh = request.headers.get(MODS_REFRESH_SESSION_HEADER) === "1";
    try {
        const supabase = await dependencies.getAuthClient();
        const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] = await Promise.all([
            supabase.auth.getUser(),
            supabase.auth.getSession(),
        ]);
        const user = userData.user;
        const session = sessionData.session;
        if (userError || sessionError || !user || !session || session.user.id !== user.id) return null;
        const expiresSoon = session.expires_at === undefined || session.expires_at * 1_000 - dependencies.now() < REFRESH_BEFORE_EXPIRY_MILLISECONDS;
        if (!forceRefresh && !expiresSoon) return session.access_token;
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session && data.session.user.id === user.id) return data.session.access_token;
        return forceRefresh ? null : session.access_token;
    } catch {
        return null;
    }
}

/** Runs one Edge call and answers its result, or its failure with a closed code. */
async function relay(call: () => Promise<unknown>): Promise<Response> {
    try {
        return Response.json({ ok: true, result: await call() }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
        if (error instanceof MyServersApiError) {
            const refusal = modRefusalFromErrorMessage(error.message);
            return failure(error.code, error.retryable, refusal?.modId ?? null, refusal?.issue ?? null);
        }
        // A result that broke the contract is an unknown outcome; an identical resend replays safely.
        return failure("invalid_response", true);
    }
}

/** Answers one failure in the browser envelope, naming the issue only when there is one. */
function failure(code: string, retryable: boolean, modId: string | null = null, issue: string | null = null): Response {
    const error: ServerModsRouteError = issue === null ? { code, retryable, modId } : { code, retryable, modId, issue };
    return Response.json({ ok: false, error }, { status: ERROR_STATUS[code] ?? 409, headers: { "cache-control": "private, no-store" } });
}
