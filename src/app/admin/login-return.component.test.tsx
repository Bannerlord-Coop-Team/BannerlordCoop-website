import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AdminPage from "./page";
import ControlPlaneAdminPage from "./control-plane/page";
import LoginPage from "../login/page";
import { GET as authCallback } from "../auth/callback/route";

const mocks = vi.hoisted(() => ({
    user: vi.fn(), session: vi.fn(), viewer: vi.fn(), read: vi.fn(), oauth: vi.fn(), exchange: vi.fn(),
    redirect: vi.fn((target: string): never => { throw new Error(`redirect:${target}`); }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", async importOriginal => ({
    ...await importOriginal<typeof import("next/navigation")>(), redirect: mocks.redirect,
}));
vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: async () => ({ auth: { getUser: mocks.user, exchangeCodeForSession: mocks.exchange } }),
    createSupabaseServerClient: vi.fn(), getSupabaseServerReadSession: mocks.session, getSupabaseServerViewer: mocks.viewer,
}));
vi.mock("@/app/lib/supabase/client", () => ({
    getSupabaseBrowserClient: () => ({ auth: { signInWithOAuth: mocks.oauth } }),
}));
vi.mock("@/app/lib/control-plane/server-read", () => ({ readControlPlaneAdmin: mocks.read }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Root[] = [];
beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ data: { user: null } });
    mocks.session.mockResolvedValue({ session: null, impersonating: false });
    mocks.viewer.mockResolvedValue({ user: null, accessToken: null });
    mocks.read.mockResolvedValue({});
    mocks.oauth.mockResolvedValue({ error: null });
    mocks.exchange.mockResolvedValue({ error: null });
});
afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.replaceChildren();
});

async function completeLogin(expectedTarget: string) {
    const loginHref = mocks.redirect.mock.calls.at(-1)![0];
    const login = new URL(loginHref, window.location.origin);
    expect(loginHref).toContain("/login?next=%2Fadmin");
    expect(login.origin).toBe(window.location.origin);
    expect(login.searchParams.size).toBe(1);
    expect(login.searchParams.get("next")).toBe(expectedTarget);
    const page = await LoginPage({ searchParams: Promise.resolve({ next: login.searchParams.get("next")! }) });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(page));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(mocks.oauth).toHaveBeenCalledExactlyOnceWith({
        provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback?${new URLSearchParams({ next: expectedTarget })}` },
    });
    const callback = new URL(mocks.oauth.mock.calls[0][0].options.redirectTo);
    callback.searchParams.set("code", "fixture-auth-code");
    const response = await authCallback(new NextRequest(callback));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${window.location.origin}${expectedTarget}`);
    expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("fixture-auth-code");
}

it("returns a signed-out administrator to the exact email account target after sign-in", async () => {
    const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await expect(AdminPage({ searchParams: Promise.resolve({ q: accountId }) })).rejects.toThrow("redirect:/login");
    await completeLogin(`/admin?q=${accountId}`);
    expect(mocks.user).toHaveBeenCalledOnce();
});

it.each(["missing", "expired"])("returns a %s admin session to the exact email server target after sign-in", async session => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    if (session === "expired") mocks.session.mockResolvedValue({ impersonating: false, session: { access_token: "fixture-token", user: { id: "fixture-admin" } } });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "server", serverId }) })).rejects.toThrow("redirect:/login");
    await completeLogin(`/admin/control-plane?view=server&serverId=${serverId}`);
    expect(mocks.viewer).toHaveBeenCalledTimes(session === "expired" ? 1 : 0);
});

it("preserves an account query containing an external URL as query data through sign-in", async () => {
    await expect(AdminPage({ searchParams: Promise.resolve({ q: "//evil.test/path?x=1&next=/account" }) })).rejects.toThrow("redirect:/login");
    await completeLogin("/admin?q=%2F%2Fevil.test%2Fpath%3Fx%3D1%26next%3D%2Faccount");
});
