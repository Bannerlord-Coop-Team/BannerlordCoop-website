import { boundedJson, record, UUID } from "./membership.ts";
/** Verify current session context against a verified identity, allowing both reads to overlap. */
export async function verifyWebsiteSessionContext(options: {
    supabaseUrl: string; key: string; authorization: string; userId: string | Promise<string>; action: string; fetch?: typeof fetch; requestId?: string; signal?: AbortSignal;
}) {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000);
    const [context, userId] = await Promise.all([
        (async () => {
            const response = await (options.fetch ?? fetch)(new URL('/rest/v1/rpc/website_session_context', options.supabaseUrl), {
                method: 'POST', cache: 'no-store', redirect: 'manual', signal, // workerd rejects redirect: 'error'; a manual 3xx is not ok.
                headers: { apikey: options.key, authorization: options.authorization, 'content-type': 'application/json' },
                body: JSON.stringify({ p_action: options.action, p_request_id: options.requestId ?? crypto.randomUUID() }),
            });
            if (signal.aborted || !response.ok) {
                void response.body?.cancel().catch(() => undefined);
                throw new Error('Session unavailable');
            }
            const context = await boundedJson(response, 4096);
            signal.throwIfAborted();
            return context;
        })(),
        options.userId,
    ]);
    options.signal?.throwIfAborted();
    if (!record(context) || !('impersonationId' in context)) throw new Error('Invalid session context');
    if (context.impersonationId === null) return;
    if (typeof context.impersonationId !== 'string' || !UUID.test(context.impersonationId) || !('targetId' in context) || context.targetId !== userId
        || !('actorId' in context) || typeof context.actorId !== 'string' || !UUID.test(context.actorId)
        || typeof context.expiresAt !== 'string' || !Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= Date.now()) throw new Error('Invalid session context');
}
