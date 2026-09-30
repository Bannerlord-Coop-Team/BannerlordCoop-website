import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseServerViewer } from "./server";
import { IMPERSONATION_COOKIE } from "../auth/impersonation-cookie";

const mocks = vi.hoisted(() => ({ create: vi.fn(), cookie: vi.fn(), resolve: vi.fn() }));
vi.mock("@supabase/ssr", async (original) => ({ ...await original<object>(), createServerClient: mocks.create }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie, getAll: () => [], set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("../auth/impersonation", () => ({ resolveImpersonation: mocks.resolve }));
const user = { id: "44444444-4444-4444-8444-444444444444", app_metadata: { role: "Admin" } };
const session = { access_token: "verified-token", user };
let client: ReturnType<typeof fixture>;
function fixture() {
    const context = vi.fn().mockResolvedValue({ data: { impersonationId: null }, error: null });
    return { auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    }, rpc: vi.fn().mockReturnValue({ setHeader: context }), context };
}
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
    client = fixture(); mocks.create.mockReturnValue(client);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("starts both checks and withholds the viewer until both succeed using the same token", async () => {
    const identity = Promise.withResolvers<unknown>(), context = Promise.withResolvers<unknown>();
    client.auth.getUser.mockReturnValue(identity.promise); client.context.mockReturnValue(context.promise);
    const result = getSupabaseServerViewer(); let completed = false; void result.then(() => { completed = true; });
    await vi.waitFor(() => expect(client.context).toHaveBeenCalledWith("Authorization", "Bearer verified-token"));
    expect(client.auth.getUser).toHaveBeenCalledWith("verified-token");
    identity.resolve({ data: { user }, error: null }); await Promise.resolve(); expect(completed).toBe(false);
    context.resolve({ data: { impersonationId: null }, error: null });
    expect(await result).toEqual({ client, user, accessToken: "verified-token" });
});
it.each([{ data: null, error: new Error("unavailable") }, { data: {}, error: null }, { data: { impersonationId: "unexpected" }, error: null }])("rejects failed or unexpected context %j", async (context) => {
    client.context.mockResolvedValue(context);
    await expect(getSupabaseServerViewer()).rejects.toThrow("Session context unavailable");
});
it("never trusts a cached session user instead of the fresh user or a mismatched session token", async () => {
    client.auth.getUser.mockResolvedValue({ data: { user: { ...user, app_metadata: { role: "Member" } } }, error: null });
    expect((await getSupabaseServerViewer()).user?.app_metadata.role).toBe("Member");
    client.auth.getUser.mockResolvedValue({ data: { user: { ...user, id: "another-user" } }, error: null });
    expect((await getSupabaseServerViewer()).accessToken).toBeNull();
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error("revoked") });
    expect(await getSupabaseServerViewer()).toMatchObject({ user: null, accessToken: null });
    expect(client.context).toHaveBeenCalledTimes(3);
});
it("refreshes through getSession first and fails closed on refresh failure or absence", async () => {
    client.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error("refresh failed") });
    await expect(getSupabaseServerViewer()).rejects.toThrow("refresh failed");
    client.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await getSupabaseServerViewer()).toMatchObject({ user: null, accessToken: null });
    expect(client.auth.getUser).not.toHaveBeenCalled(); expect(client.rpc).not.toHaveBeenCalled();
    client.auth.getSession.mockResolvedValueOnce({ data: { session: { ...session, access_token: "refreshed-token" } }, error: null });
    expect((await getSupabaseServerViewer()).accessToken).toBe("refreshed-token");
    expect(client.auth.getUser).toHaveBeenCalledWith("refreshed-token");
    expect(client.context).toHaveBeenCalledWith("Authorization", "Bearer refreshed-token");
});
it("preserves actor and target impersonation validation before returning a viewer", async () => {
    mocks.cookie.mockImplementation((name) => name === IMPERSONATION_COOKIE ? { value: "signed-selection" } : undefined);
    const gate = Promise.withResolvers<void>(); mocks.resolve.mockReturnValue(gate.promise);
    const result = getSupabaseServerViewer();
    await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith(client, client, "signed-selection"));
    expect(client.auth.getUser).not.toHaveBeenCalled();
    gate.resolve(); expect((await result).accessToken).toBe("verified-token");
    expect(client.rpc).not.toHaveBeenCalled();
    mocks.resolve.mockRejectedValueOnce(new Error("expired"));
    await expect(getSupabaseServerViewer()).rejects.toThrow("redirect:/admin?error=Impersonation");
});

it("overlaps actual SDK HTTP calls even while the user endpoint is stalled", async () => {
    const actual = await vi.importActual<{ createServerClient: typeof createServerClient }>("@supabase/ssr");
    const response = Promise.withResolvers<Response>(); const requests: string[] = [];
    const jwt = `e30.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
    const stored = { ...session, access_token: jwt, refresh_token: "test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer" };
    const sdk = actual.createServerClient("https://example.supabase.co", "test-public-key", {
        cookies: { getAll: () => [{ name: "sb-example-auth-token", value: `base64-${Buffer.from(JSON.stringify(stored)).toString("base64url")}` }], setAll: () => {} },
        global: { fetch: async (input, init) => {
            const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
            requests.push(path);
            expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${jwt}`);
            if (path === "/auth/v1/user") return response.promise;
            if (path === "/rest/v1/rpc/website_session_context") return Response.json({ impersonationId: null });
            throw new Error(`Unexpected endpoint: ${path}`);
        } },
    });
    mocks.create.mockReturnValue(sdk);
    const result = getSupabaseServerViewer();
    try {
        await vi.waitFor(() => expect(requests).toContain("/rest/v1/rpc/website_session_context"));
        expect(requests).toContain("/auth/v1/user");
    } finally { response.resolve(Response.json(user)); }
    expect((await result).accessToken).toBe(jwt);
});


it("starts the independently authorized read with the refreshed token while verification is pending", async () => {
    const gate = Promise.withResolvers<unknown>();
    client.auth.getUser.mockReturnValue(gate.promise);
    const start = vi.fn();
    const pending = getSupabaseServerViewer({ onReadOnlySession: start });
    await vi.waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith("verified-token"));
    gate.resolve({ data: { user }, error: null });
    await pending;
    client.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await getSupabaseServerViewer({ onReadOnlySession: start });
    expect(start).toHaveBeenCalledTimes(1);
});

it("does not start early reads before impersonation resolution or after it fails", async () => {
    mocks.cookie.mockImplementation(name => name === IMPERSONATION_COOKIE ? { value: "signed-selection" } : undefined);
    const gate = Promise.withResolvers<void>(); mocks.resolve.mockReturnValue(gate.promise);
    const start = vi.fn();
    const pending = getSupabaseServerViewer({ onReadOnlySession: start });
    await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalled());
    expect(start).not.toHaveBeenCalled();
    gate.resolve(); await pending;
    expect(start).toHaveBeenCalledTimes(1);
    mocks.resolve.mockRejectedValueOnce(new Error("expired"));
    await expect(getSupabaseServerViewer({ onReadOnlySession: start })).rejects.toThrow("redirect:/admin?error=Impersonation");
    expect(start).toHaveBeenCalledTimes(1);
});
