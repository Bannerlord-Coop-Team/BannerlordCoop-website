import { exactKeys, isRecord, parsePublicServerPage, readPublicResponse, REQUEST_ID } from "./server-visibility-contract.ts";

export function createPublicServersHandler(options: {
    allowedOrigins: readonly string[];
    controlPlaneUrl: string;
    fetchImplementation?: typeof fetch;
}) {
    const origins = new Set(options.allowedOrigins.map(origin));
    if (origins.size === 0 || origins.size !== options.allowedOrigins.length) throw new Error("Invalid allowed origins");
    const endpoint = new URL("/v1/public/control-plane", origin(options.controlPlaneUrl));
    const fetcher = options.fetchImplementation ?? fetch;
    return async (request: Request): Promise<Response> => {
        const suppliedId = request.headers.get("x-request-id") ?? "";
        const requestId = REQUEST_ID.test(suppliedId) ? suppliedId : crypto.randomUUID();
        const requestOrigin = request.headers.get("origin");
        const headers: Record<string, string> = {
            "cache-control": "no-store", "content-type": "application/json", "x-request-id": requestId,
            "x-content-type-options": "nosniff", "vary": "Origin",
        };
        function fail(status: number, code: string) {
            return new Response(JSON.stringify({ version: 1, requestId, ok: false, error: {
                code, message: "The public server directory is unavailable.", retryable: status >= 500,
            } }), { status, headers });
        }
        if (requestOrigin !== null && !origins.has(requestOrigin)) return fail(403, "origin_forbidden");
        if (requestOrigin !== null) {
            headers["access-control-allow-origin"] = requestOrigin;
            headers["access-control-allow-methods"] = "GET, OPTIONS";
            headers["access-control-allow-headers"] = "apikey, x-request-id";
        }
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
        if (request.method !== "GET") return fail(405, "method_not_allowed");
        if (request.url.length > 4_096) return fail(414, "invalid_request");
        const params = new URL(request.url).searchParams;
        if ([...params.keys()].some(key => !["cursor", "limit"].includes(key) || params.getAll(key).length !== 1)) return fail(400, "invalid_request");
        const cursor = params.get("cursor");
        const rawLimit = params.get("limit") ?? "50";
        const limit = Number(rawLimit);
        if (!/^[1-9]\d{0,2}$/u.test(rawLimit) || limit > 100
            || (cursor !== null && (cursor.length === 0 || cursor.length > 2_048 || /[\p{Cc}\p{Cf}]/u.test(cursor)))) return fail(400, "invalid_request");
        try {
            const upstream = await fetcher(endpoint, {
                method: "POST", redirect: "error", cache: "no-store",
                headers: { "content-type": "application/json", "x-request-id": requestId },
                body: JSON.stringify({ version: 1, requestId, operation: "public-servers", input: { cursor, limit } }),
                signal: AbortSignal.timeout(15_000),
            });
            if (!upstream.ok) { await upstream.body?.cancel(); return fail(502, "directory_unavailable"); }
            const envelope = await readPublicResponse(upstream);
            if (!isRecord(envelope) || !exactKeys(envelope, ["version", "requestId", "ok", "result"])
                || envelope.version !== 1 || envelope.requestId !== requestId || envelope.ok !== true) throw new Error("Invalid envelope");
            const result = parsePublicServerPage(envelope.result);
            if (result.items.length > limit) throw new Error("Invalid page size");
            return new Response(JSON.stringify({ version: 1, requestId, ok: true, result }), { headers });
        } catch { return fail(502, "directory_unavailable"); }
    };
}
function origin(value: string): string {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new Error("Invalid HTTPS origin");
    return url.origin;
}
