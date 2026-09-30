import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>(), raw: vi.fn(), admin: vi.fn(), upstream: vi.fn(), invoke: vi.fn(), target: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
    get: (name: string) => mocks.jar.has(name) ? { name, value: mocks.jar.get(name) } : undefined,
    getAll: () => [...mocks.jar].map(([name, value]) => ({ name, value })), has: (name: string) => mocks.jar.has(name),
    set: (name: string, value: string, options?: { maxAge?: number; secure?: boolean; path?: string }) => {
        if (options?.maxAge === 0) { expect(options).toMatchObject({ secure: true, path: "/" }); mocks.jar.delete(name); }
        else mocks.jar.set(name, value);
    },
}) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.raw }));
vi.mock("@/app/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: mocks.upstream }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { IMPERSONATION_COOKIE, IMPERSONATION_SECONDS, signImpersonation, verifyImpersonation } from "@/app/lib/auth/impersonation-cookie";
import { legacyDiscordIdentity } from "@/app/lib/auth/impersonation";
import { startImpersonation, stopImpersonation, readImpersonatedServers } from "./impersonation-actions";
import { updateMemberRole } from "./actions";
import { ImpersonationBanner } from "@/app/components/admin/ImpersonationBanner";

const actorId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const selectionId = "44444444-4444-4444-8444-444444444444";
const secret = "isolated-impersonation-fixture-key";
const token = `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.fixture`;
let actor: User;
let target: User;
let raw: { auth: { getUser: ReturnType<typeof vi.fn>; getSession: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> }; functions: { invoke: typeof mocks.invoke } };
function selection() { const issuedAt = Date.now(); return { id: selectionId, actorId, actorSessionId: sessionId, targetId, issuedAt, expiresAt: issuedAt + IMPERSONATION_SECONDS * 1000 }; }
function select() { mocks.jar.set(IMPERSONATION_COOKIE, signImpersonation(selection(), secret)); }
beforeEach(() => {
    vi.clearAllMocks(); mocks.jar.clear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "isolated-publishable-fixture-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", secret); vi.stubEnv("SUPABASE_ADMIN_EMAILS", "");
    actor = { id: actorId, app_metadata: { role: "Admin" }, user_metadata: { name: "Admin fixture" }, email: "admin@example.invalid", identities: [] } as unknown as User;
    target = { id: targetId, app_metadata: { role: "User" }, user_metadata: { name: "Member fixture" }, email: "member@example.invalid", identities: [] } as unknown as User;
    raw = { auth: { getUser: vi.fn(async () => ({ data: { user: actor }, error: null })), getSession: vi.fn(async () => ({ data: { session: { user: actor, access_token: token, refresh_token: "private-admin-refresh" } }, error: null })), signOut: vi.fn() }, functions: { invoke: mocks.invoke } };
    mocks.raw.mockReturnValue(raw); mocks.target.mockImplementation(async () => ({ data: { user: target }, error: null }));
    mocks.admin.mockReturnValue({ auth: { admin: { getUserById: mocks.target } } });
    mocks.upstream.mockResolvedValue({ items: [], nextCursor: null }); mocks.invoke.mockResolvedValue({ data: {}, error: null });
});

it("starts with audited real admin authority, exposes only the target view and harmless marker, and exits without signing anyone out", async () => {
    const form = new FormData(); form.set("userId", targetId);
    await expect(startImpersonation(form)).rejects.toThrow("redirect:/servers");
    expect(mocks.upstream).toHaveBeenCalledWith(expect.objectContaining({ accessToken: token, operation: "view-as-user", input: expect.objectContaining({ accountId: targetId }) }));
    const client = await getSupabaseServerClient();
    expect((await client.auth.getUser()).data.user).toBe(target);
    const session = (await client.auth.getSession()).data.session!;
    expect(session.access_token).toMatch(/^view-as:/); expect(session.refresh_token).toBe("");
    expect(JSON.stringify(session)).not.toContain(token); expect(JSON.stringify(session)).not.toContain("private-admin-refresh");
    expect(() => client.auth.updateUser({ data: { name: "changed" } })).toThrow("read-only");
    await expect(getSupabaseServerClient({ impersonation: "deny" })).rejects.toThrow("read-only");
    await expect(stopImpersonation()).rejects.toThrow("redirect:/admin");
    expect(mocks.jar.has(IMPERSONATION_COOKIE)).toBe(false); expect(raw.auth.signOut).not.toHaveBeenCalled();
    expect((await (await getSupabaseServerClient()).auth.getUser()).data.user).toBe(actor);
});

it("fails closed for tampering, expiration, changed login, removed admin access, and deleted target", async () => {
    const valid = signImpersonation(selection(), secret);
    expect(() => verifyImpersonation(`${valid}x`, secret, actorId, sessionId)).toThrow();
    expect(() => verifyImpersonation(valid, secret, actorId, targetId)).toThrow();
    expect(() => verifyImpersonation(valid, secret, actorId, sessionId, Date.now() + 31 * 60_000)).toThrow();
    mocks.jar.set(IMPERSONATION_COOKIE, "");
    await expect(getSupabaseServerClient()).rejects.toThrow("redirect:/admin?error=Impersonation");
    await expect(getSupabaseServerClient({ impersonation: "deny" })).rejects.toThrow("read-only");
    select(); actor.app_metadata.role = "User";
    await expect(getSupabaseServerClient()).rejects.toThrow("redirect:/admin?error=Impersonation");
    actor.app_metadata.role = "Admin"; mocks.target.mockResolvedValue({ data: { user: null }, error: null });
    await expect(getSupabaseServerClient()).rejects.toThrow("redirect:/admin?error=Impersonation");
    const banner = renderToStaticMarkup(await ImpersonationBanner());
    expect(banner).toContain("Exit impersonation"); expect(banner).toContain("expired or unavailable");
    await expect(stopImpersonation()).rejects.toThrow("redirect:/admin");
});

it("rechecks actor and target for each read, rejects old selections, and never accepts download or mutation intent", async () => {
    select();
    await readImpersonatedServers(`view-as:${selectionId}`, "resource=backups&serverId=" + targetId);
    expect(mocks.upstream).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: token, operation: "view-as-user",
        input: expect.objectContaining({ accountId: targetId, request: expect.objectContaining({ operation: "server-backups" }) }) }));
    for (const query of ["operation=stop", "resource=download-server-log&serverId=" + targetId, "resource=files&serverId=../bad", "resource=onboarding&resource=files"]) {
        await expect(readImpersonatedServers(`view-as:${selectionId}`, query)).rejects.toThrow();
    }
    await expect(readImpersonatedServers(`view-as:${targetId}`, "")).rejects.toThrow("selected user changed");
    actor.app_metadata.role = "User";
    await expect(readImpersonatedServers(`view-as:${selectionId}`, "")).rejects.toThrow("administrator");
    expect(mocks.upstream).toHaveBeenCalledTimes(1);
});

it("keeps account status read-only and rejects privileged role writes even while viewing another admin", async () => {
    select(); target.app_metadata.role = "Admin";
    const client = await getSupabaseServerClient();
    await client.functions.invoke("website-account", { body: { operation: "status" } });
    expect(mocks.invoke).toHaveBeenCalledWith("website-account", { headers: { Authorization: `Bearer ${token}` }, body: { operation: "preview-status", accountId: targetId } });
    await expect(client.functions.invoke("website-account", { body: { operation: "unlink" } })).rejects.toThrow("read-only");
    const form = new FormData(); form.set("userId", actorId); form.set("role", "User");
    await expect(updateMemberRole(form)).rejects.toThrow("read-only");
    expect(renderToStaticMarkup(await ImpersonationBanner())).toContain("Viewing as Member fixture");
});

it("does not use mutable metadata or ambiguous Discord identities to select legacy ownership", () => {
    target.user_metadata.provider_id = "123456789012345678";
    expect(legacyDiscordIdentity(target)).toBeNull();
    target.identities = [{ provider: "discord", id: "123456789012345678", user_id: targetId, identity_id: targetId, identity_data: { sub: "999456789012345678" } }];
    expect(legacyDiscordIdentity(target)).toBeNull();
});
