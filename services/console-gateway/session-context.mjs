import { randomUUID } from "node:crypto";

export async function sessionContext({ url, key, token, userId, action, fetch: request = fetch }) {
    const response = await request(new URL("/rest/v1/rpc/website_session_context", url), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(4000),
        headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ p_action: action, p_request_id: randomUUID() }),
    });
    if (!response.ok || !response.body) throw new Error("Session unavailable");
    const reader = response.body.getReader(); let text = "", length = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
        for (let chunks = 0; ; chunks++) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 4096 || chunks >= 4096) throw new Error("Invalid session context");
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const context = JSON.parse(text);
    if (!context || typeof context !== "object") throw new Error("Invalid session context");
    if (context.impersonationId === null) return null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (!uuid.test(context.impersonationId) || !uuid.test(context.actorId) || context.targetId !== userId
        || !Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= Date.now()) throw new Error("Invalid session context");
    return context;
}
