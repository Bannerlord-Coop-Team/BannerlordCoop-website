import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { User, Session } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>(), raw: vi.fn(), admin: vi.fn(), transient: vi.fn(), password: vi.fn(), revoke: vi.fn(), rpc: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
    get: (name: string) => mocks.jar.has(name) ? { name, value: mocks.jar.get(name) } : undefined,
    getAll: () => [...mocks.jar].map(([name, value]) => ({ name, value })), has: (name: string) => mocks.jar.has(name),
    set: (name: string, value: string, options?: { maxAge?: number; secure?: boolean; path?: string }) => {
        if (options?.maxAge === 0) { expect(options).toMatchObject({ secure: true, path: "/" }); mocks.jar.delete(name); }
        else mocks.jar.set(name, value);
    },
}) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.raw }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.transient }));
vi.mock("@/app/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/app/lib/hosting/my-servers", async importOriginal => ({ ...await importOriginal<object>(), requestMyServerPassword: mocks.password }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { ADMIN_COOKIE_PREFIX, IMPERSONATION_COOKIE, IMPERSONATION_SECONDS, signImpersonation, verifyImpersonation } from "@/app/lib/auth/impersonation-cookie";
import { bindLinkedImpersonationSession } from "@/app/lib/auth/impersonation";
import { startImpersonation, stopImpersonation } from "./impersonation-actions";
import { setManagedServerPassword } from "@/app/servers/managed-server-actions";
import { ImpersonationBanner } from "@/app/components/admin/ImpersonationBanner";

const actorId = "11111111-1111-4111-8111-111111111111", targetId = "22222222-2222-4222-8222-222222222222";
const actorSessionId = "33333333-3333-4333-8333-333333333333", targetSessionId = "44444444-4444-4444-8444-444444444444";
const secret = "isolated-impersonation-fixture-key";
const token = (id: string) => `header.${Buffer.from(JSON.stringify({ session_id: id })).toString("base64url")}.fixture`;
let actor: User, target: User, primary: Session | null, backup: Session | null, issued: Session;
let active: boolean, selectionId: string;
function session(user: User, id: string): Session { return { user, access_token: token(id), refresh_token: `refresh-${id}`, expires_in: 3600, token_type: "bearer" }; }
async function start() { const form = new FormData(); form.set("userId", targetId); await expect(startImpersonation(form)).rejects.toThrow("redirect:/servers"); }
beforeEach(() => {
    vi.clearAllMocks(); mocks.jar.clear(); active = false;
    vi.stubEnv("ADMIN_IMPERSONATION_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "isolated-publishable-fixture-key"); vi.stubEnv("SUPABASE_SECRET_KEY", secret);
    actor = { id: actorId, app_metadata: { role: "Admin" }, user_metadata: { name: "Admin fixture" }, email: "admin@example.invalid", identities: [] } as unknown as User;
    target = { id: targetId, app_metadata: { role: "User" }, user_metadata: { name: "Member fixture" }, email: "member@example.invalid", identities: [] } as unknown as User;
    primary = session(actor, actorSessionId); backup = null; issued = session(target, targetSessionId);
    mocks.raw.mockImplementation((_url, _key, options) => {
        const saved = options.cookieOptions?.name === ADMIN_COOKIE_PREFIX;
        const current = () => saved ? backup : primary;
        return { auth: {
            getUser: async () => ({ data: { user: current()?.user ?? null }, error: null }),
            getSession: async () => ({ data: { session: current() }, error: null }),
            setSession: async (value: Session) => { if (saved) { expect(options.cookieOptions).toMatchObject({ httpOnly: true, secure: true }); backup = value; } else primary = value; return { data: { session: value }, error: null }; },
            signOut: async (options: unknown) => { expect(options).toEqual({ scope: "local" }); primary = null; return { error: null }; },
        }, rpc: async () => current()?.user.id === actorId ? { data: { impersonationId: null }, error: null }
            : { data: active ? { impersonationId: selectionId, actorId, targetId } : null, error: active ? null : new Error("ended") } };
    });
    mocks.rpc.mockImplementation(async (name, input) => { if (name === "website_impersonation_begin") { selectionId = input.p_id; active = true; } if (name === "website_impersonation_end") active = false; return { error: null }; });
    mocks.revoke.mockResolvedValue({ error: null });
    mocks.admin.mockReturnValue({ rpc: mocks.rpc, auth: { admin: { getUserById: async () => ({ data: { user: target }, error: null }),
        generateLink: async () => ({ data: { user: target, properties: { hashed_token: "server-only-otp" } }, error: null }), signOut: mocks.revoke } } });
    mocks.transient.mockReturnValue({ auth: { verifyOtp: async () => ({ data: { user: issued.user, session: issued }, error: null }) } });
    mocks.password.mockResolvedValue({ changed: true, restartQueued: false });
});

it.each([undefined, "false", "TRUE", "1"])("refuses issuance before using Auth when the release switch is %s", async (value) => {
    vi.stubEnv("ADMIN_IMPERSONATION_ENABLED", value);
    const form = new FormData(); form.set("userId", targetId);
    await expect(startImpersonation(form)).rejects.toThrow("User+impersonation+is+not+enabled");
    expect(mocks.raw).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.transient).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(primary?.user.id).toBe(actorId); expect(mocks.jar.size).toBe(0);
});

it("opens a real target session, performs a server write as the target, and restores the saved admin without global sign-out", async () => {
    await start();
    const client = await getSupabaseServerClient();
    expect((await client.auth.getUser()).data.user).toBe(target);
    expect((await client.auth.getSession()).data.session?.access_token).toBe(issued.access_token);
    expect(backup?.user.id).toBe(actorId);
    const result = await setManagedServerPassword({ serverId: targetId, expectedUpdatedAt: "2026-09-01T00:00:00.000Z", password: "fixture-only-password" });
    expect(result.ok).toBe(true);
    expect(mocks.password.mock.calls[0][0]).toBe(issued.access_token);
    const banner = renderToStaticMarkup(await ImpersonationBanner());
    expect(banner).toContain("Impersonating Member fixture"); expect(banner).toContain("Actions change this user");
    vi.stubEnv("ADMIN_IMPERSONATION_ENABLED", "false");
    await expect(stopImpersonation()).rejects.toThrow("redirect:/admin");
    expect(primary?.user.id).toBe(actorId); expect(active).toBe(false); expect(mocks.jar.has(IMPERSONATION_COOKIE)).toBe(false);
    expect(mocks.revoke).toHaveBeenCalledWith(issued.access_token, "local");
    expect(mocks.revoke.mock.calls.every(call => call[1] === "local")).toBe(true);
});

it("rejects expired selection and revoked administrator authority while keeping Exit functional", async () => {
    await start();
    const selection = verifyImpersonation(mocks.jar.get(IMPERSONATION_COOKIE)!, secret);
    const issuedAt = Date.now() - 31 * 60_000;
    mocks.jar.set(IMPERSONATION_COOKIE, signImpersonation({ ...selection, issuedAt, expiresAt: issuedAt + IMPERSONATION_SECONDS * 1000 }, secret));
    await expect(getSupabaseServerClient()).rejects.toThrow("redirect:/admin?error=Impersonation");
    expect(renderToStaticMarkup(await ImpersonationBanner())).toContain("Exit impersonation");
    actor.app_metadata.role = "User";
    await expect(stopImpersonation()).rejects.toThrow("redirect:/admin");
    expect(primary?.user.id).toBe(actorId);
});

it("rejects ordinary users before minting a target session", async () => {
    actor.app_metadata.role = "User";
    const form = new FormData(); form.set("userId", targetId);
    await expect(startImpersonation(form)).rejects.toThrow("could+not+start");
    expect(mocks.transient).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(primary?.user.id).toBe(actorId);
});

it("closes a failed issuance and never adopts a session for a different account", async () => {
    issued = session(actor, targetSessionId);
    const form = new FormData(); form.set("userId", targetId);
    await expect(startImpersonation(form)).rejects.toThrow("could+not+start");
    expect(primary?.user.id).toBe(actorId); expect(active).toBe(false);
    expect(mocks.jar.has(IMPERSONATION_COOKIE)).toBe(false);
    expect(mocks.revoke).toHaveBeenCalledWith(issued.access_token, "local");
});

it("binds the same user's OAuth-linked session and preserves the original admin and expiry", async () => {
    await start();
    const before = verifyImpersonation(mocks.jar.get(IMPERSONATION_COOKIE)!, secret);
    primary = session(target, "55555555-5555-4555-8555-555555555555");
    const raw = mocks.raw("", "", {});
    await bindLinkedImpersonationSession(raw, issued.access_token);
    const after = verifyImpersonation(mocks.jar.get(IMPERSONATION_COOKIE)!, secret);
    expect(after).toEqual({ ...before, targetSessionId: "55555555-5555-4555-8555-555555555555" });
    expect(backup?.user.id).toBe(actorId);
    expect(mocks.rpc).toHaveBeenLastCalledWith("website_impersonation_bind", expect.objectContaining({ p_actor_id: actorId, p_target_session_id: after.targetSessionId }));
});

it("fails closed after durable termination even if the native access token remains valid", async () => {
    await start(); active = false;
    await expect(getSupabaseServerClient()).rejects.toThrow("redirect:/admin?error=Impersonation");
    expect(() => verifyImpersonation(mocks.jar.get(IMPERSONATION_COOKIE)! + "x", secret)).toThrow();
});


it("recovers a damaged selection cookie using the independently verified admin backup", async () => {
    await start();
    mocks.jar.set(IMPERSONATION_COOKIE, "damaged-cookie");
    await expect(stopImpersonation()).rejects.toThrow("redirect:/admin");
    expect(primary?.user.id).toBe(actorId);
    expect(mocks.rpc).toHaveBeenLastCalledWith("website_impersonation_end", expect.objectContaining({ p_id: null, p_actor_id: actorId, p_actor_session_id: actorSessionId }));
    expect(mocks.jar.has(IMPERSONATION_COOKIE)).toBe(false);
});

it("removing the selection cannot turn a delegated session into an ordinary user login", async () => {
    await start();
    mocks.jar.delete(IMPERSONATION_COOKIE);
    await expect(getSupabaseServerClient()).rejects.toThrow("Session context unavailable");
    await expect(getSupabaseServerClient({ impersonation: "actor" })).rejects.toThrow("Session context unavailable");
});

it("removes an OAuth login that could not be registered", async () => {
    await start();
    primary = session(target, "55555555-5555-4555-8555-555555555555");
    mocks.rpc.mockResolvedValue({ error: new Error("registration failed") });
    await expect(bindLinkedImpersonationSession(mocks.raw("", "", {}), issued.access_token)).rejects.toThrow("registration failed");
    expect(primary).toBeNull();
    expect(backup?.user.id).toBe(actorId);
});


it("retains Exit and the admin backup when native session revocation fails, then retries locally", async () => {
    await start();
    mocks.revoke.mockResolvedValueOnce({ error: { status: 503, name: "AuthApiError" } });
    await expect(stopImpersonation()).rejects.toThrow("Retry Exit");
    expect(mocks.jar.has(IMPERSONATION_COOKIE)).toBe(true);
    expect(backup?.user.id).toBe(actorId);
    expect(active).toBe(false);
    await expect(stopImpersonation()).rejects.toThrow("redirect:/admin");
    expect(primary?.user.id).toBe(actorId);
});


it("cannot use a delegated admin token as the original actor or restore it from a forged backup", async () => {
    target.app_metadata.role = "Admin";
    await start();
    backup = issued;
    mocks.jar.set(IMPERSONATION_COOKIE, "damaged-cookie");
    await expect(getSupabaseServerClient({ impersonation: "actor" })).rejects.toThrow("Session context unavailable");
    await expect(stopImpersonation()).rejects.toThrow("redirect:/login");
    expect(primary).toBeNull();
});
