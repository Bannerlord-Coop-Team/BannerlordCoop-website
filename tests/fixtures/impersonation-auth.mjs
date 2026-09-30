// Disposable browser-test Auth/data; no production endpoints or credentials.
const adminId = "11111111-1111-4111-8111-111111111111";
export const users = [[adminId, "Administrator", "Admin"], ["22222222-2222-4222-8222-222222222222", "Alice", "Standard Server"], ["33333333-3333-4333-8333-333333333333", "Bob", "User"]].map(([id, name, role]) => ({ id, aud: "authenticated", role: "authenticated", email: `${name.toLowerCase()}@example.invalid`, created_at: "2026-09-01T00:00:00Z", app_metadata: { role }, user_metadata: { name }, identities: [] }));
const state = globalThis.__impersonationFixture ??= { grants: new Map(), sessions: new Map(), revoked: new Set(), unlinked: new Set(), events: [] };
function mint(user, id = crypto.randomUUID()) {
    const value = { user, access_token: `e30.${Buffer.from(JSON.stringify({ session_id: id, sub: user.id })).toString("base64url")}.fixture`, refresh_token: `refresh-${id}`, expires_in: 3600, token_type: "bearer" };
    state.sessions.set(id, value); return value;
}
const admin = mint(users[0], "44444444-4444-4444-8444-444444444444");
function idOf(token) { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).session_id; }
function context(session) {
    if (!session || state.revoked.has(idOf(session.access_token))) throw new Error("Invalid fixture session");
    const grant = [...state.grants.values()].find(row => row.targetSession === idOf(session.access_token));
    if (!grant) return { impersonationId: null };
    if (!grant.active) throw new Error("Impersonation ended");
    return { impersonationId: grant.id, actorId: adminId, targetId: session.user.id, expiresAt: new Date(Date.now() + 30 * 60000).toISOString() };
}
export function createServerClient(_url, _key, options) {
    const name = options.cookieOptions?.name ?? "fixture-auth";
    const session = () => { const raw = options.cookies.getAll().find(row => row.name === name)?.value; return raw ? JSON.parse(Buffer.from(raw, "base64url").toString()) : name === "fixture-auth" ? admin : null; };
    return { auth: {
        getUser: async () => ({ data: { user: session()?.user ?? null }, error: null }),
        getSession: async () => ({ data: { session: session() }, error: null }),
        setSession: async value => { options.cookies.setAll([{ name, value: Buffer.from(JSON.stringify(value)).toString("base64url"), options: { secure: true, path: "/", sameSite: "lax", ...options.cookieOptions } }]); return { data: { session: value }, error: null }; },
        signOut: async ({ scope }) => { if (scope !== "local") throw new Error("Global logout forbidden"); return { error: null }; },
    }, rpc: async () => { try { return { data: context(session()), error: null }; } catch (error) { return { data: null, error }; } },
    functions: { invoke: async (name, options) => {
        const selected = session(); context(selected);
        if (name !== "website-account") throw new Error("Unexpected fixture function");
        if (options.body.operation === "unlink") { state.unlinked.add(selected.user.id); state.events.push({ action: "unlink", userId: selected.user.id }); return { data: { unlinked: true }, error: null }; }
        return { error: null, data: { version: 1, accountId: selected.user.id, hasDiscord: false, configured: true, verificationPending: false, membership: { linked: !state.unlinked.has(selected.user.id), verification: "unverified", sync: "not_needed", verifiedAt: null, validUntil: null, retryAt: null, refreshMode: "oauth_reauthorization" } } };
    } } };
}
export function createBrowserClient() { return { auth: { getSession: async () => ({ data: { session: null }, error: null }) } }; }
export function createClient() { return { auth: { verifyOtp: async ({ token_hash }) => { const user = users.find(user => user.id === token_hash); return { data: { user, session: mint(user) }, error: null }; } } }; }
export function getSupabaseAdminClient() {
    return { rpc: async (name, input) => {
        if (name === "website_impersonation_begin") state.grants.set(input.p_id, { id: input.p_id, active: true, targetId: input.p_target_id });
        else if (name === "website_impersonation_bind") state.grants.get(input.p_id).targetSession = input.p_target_session_id;
        else if (name === "website_impersonation_end") state.grants.get(input.p_id).active = false;
        else throw new Error("Unexpected fixture RPC");
        return { data: null, error: null };
    }, auth: { admin: {
        getUserById: async id => ({ data: { user: users.find(user => user.id === id) }, error: null }),
        listUsers: async () => ({ data: { users }, error: null }),
        generateLink: async ({ email }) => { const user = users.find(user => user.email === email); return { data: { user, properties: { hashed_token: user.id } }, error: null }; },
        signOut: async (token, scope) => { if (scope !== "local") throw new Error("Global logout forbidden"); state.revoked.add(idOf(token)); state.events.push({ action: "revoke", scope }); return { error: null }; },
    } } };
}
export async function fixtureFetch(input, init) {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname !== "fixture.invalid") throw new Error("External fixture fetch forbidden");
        const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
        const selected = state.sessions.get(idOf(token)); context(selected);
        const requestId = new Headers(init?.headers).get("x-request-id");
        if (url.searchParams.has("resource")) return Response.json({ version: 1, requestId, ok: false, error: { code: "unavailable", message: "No allocation fixture", retryable: false } }, { status: 503 });
        return Response.json({ version: 1, requestId, ok: true, result: { items: [{ serverId: selected.user.id, displayName: selected.user.user_metadata.name + " campaign", accessRole: "owner", friendlyRegion: "germany", operationState: "stopped", observedGameState: "stopped", releaseChannel: "stable", visibility: "private", connectionIp: null, gamePorts: [], updatedAt: "2026-09-01T00:00:00.000Z" }], nextCursor: null } });
}
export function fixtureResult() { return { unlinked: [...state.unlinked], events: state.events }; }
