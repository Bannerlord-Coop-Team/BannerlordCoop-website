import { boundedJson, record, UUID } from "./membership.ts";
/** Check revocation/expiry of administrator-issued sessions after Auth verifies the JWT. */
export async function verifyWebsiteSessionContext(options: {
    supabaseUrl: string; key: string; authorization: string; userId: string; action: string; fetch?: typeof fetch; requestId?: string;
}) {
    const response = await (options.fetch ?? fetch)(new URL('/rest/v1/rpc/website_session_context', options.supabaseUrl), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4_000),
        headers: { apikey: options.key, authorization: options.authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ p_action: options.action, p_request_id: options.requestId ?? crypto.randomUUID() }),
    });
    if (!response.ok) throw new Error('Session unavailable');
    const context = await boundedJson(response, 4096);
    if (!record(context) || !('impersonationId' in context)) throw new Error('Invalid session context');
    if (context.impersonationId === null) return;
    if (typeof context.impersonationId !== 'string' || !UUID.test(context.impersonationId) || !('targetId' in context) || context.targetId !== options.userId
        || !('actorId' in context) || typeof context.actorId !== 'string' || !UUID.test(context.actorId)
        || typeof context.expiresAt !== 'string' || !Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= Date.now()) throw new Error('Invalid session context');
}
