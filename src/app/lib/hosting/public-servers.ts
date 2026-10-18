import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { parsePublicServerPage, readPublicResponse, type PublicServerSummary } from "../../../../supabase/functions/_shared/server-visibility-contract";

/** Anonymous only: never forward a session or fall back to administrative inventory. */
export async function listPublicServers(fetcher: typeof fetch = fetch): Promise<PublicServerSummary[]> {
    const endpoint = "https://control-plane.bannerlordcoop.com/v1/public/control-plane";
    const items: PublicServerSummary[] = [];
    const ids = new Set<string>();
    const cursors = new Set<string>();
    const signal = AbortSignal.timeout(20_000);
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
        const requestId = crypto.randomUUID();
        const response = await fetcher(endpoint, {
            method: "POST", credentials: "omit",
            headers: { "content-type": "application/json", "x-request-id": requestId, accept: "application/json" },
            body: JSON.stringify({ version: 1, requestId, operation: "public-servers", input: { cursor, limit: 100 } }),
            // workerd supports manual redirects; the non-OK check below rejects every 3xx.
            cache: "no-store", redirect: "manual", signal,
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error("Public directory unavailable"); }
        const envelope = await readPublicResponse(response);
        if (!isRecord(envelope) || !hasExactKeys(envelope, ["version", "requestId", "ok", "result"])
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
        cursor = result.nextCursor;
    }
    throw new Error("Public directory exceeded page limit");
}
