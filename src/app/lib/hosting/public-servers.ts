import { exactKeys, isRecord, parsePublicServerPage, readPublicResponse, type PublicServerSummary } from "../../../../supabase/functions/_shared/server-visibility-contract";

/** Anonymous only: never forward a session or fall back to administrative inventory. */
export async function listPublicServers(fetcher: typeof fetch = fetch): Promise<PublicServerSummary[]> {
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!rawUrl || !key) throw new Error("Public directory is not configured");
    const endpoint = new URL(rawUrl);
    if (endpoint.protocol !== "https:" || endpoint.pathname !== "/" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Invalid public directory origin");
    endpoint.pathname = "/functions/v1/public-servers";
    endpoint.searchParams.set("limit", "100");
    const items: PublicServerSummary[] = [];
    const ids = new Set<string>();
    const cursors = new Set<string>();
    const signal = AbortSignal.timeout(20_000);
    for (let page = 0; page < 10; page++) {
        const requestId = crypto.randomUUID();
        const response = await fetcher(endpoint, {
            headers: { apikey: key, "x-request-id": requestId, accept: "application/json" },
            cache: "no-store", redirect: "error", signal,
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error("Public directory unavailable"); }
        const envelope = await readPublicResponse(response);
        if (!isRecord(envelope) || !exactKeys(envelope, ["version", "requestId", "ok", "result"])
            || envelope.version !== 1 || envelope.ok !== true || envelope.requestId !== requestId) throw new Error("Invalid public directory envelope");
        const result = parsePublicServerPage(envelope.result);
        for (const item of result.items) {
            if (ids.has(item.serverId)) throw new Error("Duplicate public server");
            ids.add(item.serverId);
            items.push(item);
        }
        if (result.nextCursor === null) return items;
        if (cursors.has(result.nextCursor)) throw new Error("Repeated public directory cursor");
        cursors.add(result.nextCursor);
        endpoint.searchParams.set("cursor", result.nextCursor);
    }
    throw new Error("Public directory exceeded page limit");
}
