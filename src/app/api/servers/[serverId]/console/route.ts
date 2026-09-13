import { getSupabaseServerClient } from "@/app/lib/supabase/server";

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SESSION_MILLISECONDS = 5 * 60_000;

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ serverId: string }> }) {
    if (!sameOriginRequest(request)) return new Response("Not found.", { status: 404 });
    const { serverId } = await context.params;
    if (!SERVER_ID.test(serverId)) return new Response("Not found.", { status: 404 });

    const supabase = await getSupabaseServerClient();
    const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
    ]);
    const session = sessionData.session;
    if (userError || sessionError || !userData.user || !session || session.user.id !== userData.user.id) {
        return new Response("Authentication is required.", { status: 401 });
    }

    let endpoint: URL;
    try {
        endpoint = consoleStreamEndpoint(process.env.CONTROL_PLANE_CONSOLE_ORIGIN);
    } catch {
        return new Response("Console streaming is unavailable.", { status: 503 });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SESSION_MILLISECONDS);
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    let upstream: Response;
    try {
        upstream = await fetch(endpoint, {
            method: "POST",
            headers: {
                accept: "text/event-stream",
                authorization: `Bearer ${session.access_token}`,
                "content-type": "application/json",
                "x-request-id": crypto.randomUUID(),
            },
            body: JSON.stringify({ serverId }),
            cache: "no-store",
            signal: controller.signal,
        });
    } catch {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
        return new Response("Console streaming is unavailable.", { status: 502 });
    }
    if (!upstream.ok || upstream.body === null || !upstream.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
        await upstream.body?.cancel().catch(() => undefined);
        const status = [401, 404, 409, 429].includes(upstream.status) ? upstream.status : 502;
        return new Response(status === 404 ? "Managed server is unavailable." : "Console streaming is unavailable.", { status });
    }

    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
        async pull(streamController) {
            try {
                const next = await reader.read();
                if (next.done) streamController.close();
                else streamController.enqueue(next.value);
            } catch (error) {
                streamController.error(error);
            }
        },
        async cancel() {
            controller.abort();
            await reader.cancel().catch(() => undefined);
        },
    });
    void reader.closed.finally(() => {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
    }).catch(() => undefined);
    return new Response(body, {
        status: 200,
        headers: {
            "cache-control": "private, no-store, no-transform",
            "content-type": "text/event-stream; charset=utf-8",
            "x-accel-buffering": "no",
        },
    });
}

export function consoleStreamEndpoint(rawOrigin: string | undefined): URL {
    if (!rawOrigin) throw new Error("missing origin");
    const endpoint = new URL(rawOrigin);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
        throw new Error("invalid origin");
    }
    endpoint.pathname = "/v1/user/console-stream";
    return endpoint;
}

function sameOriginRequest(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin" && site !== "none") return false;
    const origin = request.headers.get("origin");
    return origin === null || origin === new URL(request.url).origin;
}
