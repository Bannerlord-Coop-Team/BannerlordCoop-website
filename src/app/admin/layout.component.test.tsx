import { renderToReadableStream } from "react-dom/server";
import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), navbar: vi.fn(), cookies: new Map<string, string>() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name) } : undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/control-plane" }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: (props: unknown) => { mocks.navbar(props); return <header>Site navigation</header>; } }));
import AdminLayout from "./layout";
import { IMPERSONATION_COOKIE } from "@/app/lib/auth/impersonation-cookie-options";

const admin = { id: "11111111-1111-4111-8111-111111111111", app_metadata: { role: "Admin" }, user_metadata: {} } as unknown as User;
const member = { id: "22222222-2222-4222-8222-222222222222", app_metadata: { role: "User" }, user_metadata: {} } as unknown as User;

/** Streams the layout to completion around a stand-in page body. */
async function renderLayout() {
    const stream = await renderToReadableStream(AdminLayout({ children: <main>Admin page body</main> }));
    await stream.allReady;
    return new Response(stream).text();
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookies.clear();
    vi.stubEnv("SUPABASE_ADMIN_EMAILS", "");
    mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser } });
});

it("renders the site navbar, the admin sub-navigation and the page in order for administrators", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: admin } });
    const html = await renderLayout();

    const navbar = html.indexOf("Site navigation"), subNav = html.indexOf('aria-label="Administration"'), body = html.indexOf("Admin page body");
    expect(navbar).toBeGreaterThan(-1);
    expect(subNav).toBeGreaterThan(navbar);
    expect(body).toBeGreaterThan(subNav);
    expect(html).toContain("Admin access");
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>.*?Control Plane<\/a>/);
    expect(html.match(/<main/g)).toHaveLength(1);
});

it("shares the administrator lookup with the navbar instead of authenticating twice", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: admin } });
    await renderLayout();

    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ impersonation: "actor" });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(await mocks.navbar.mock.calls[0][0].viewer).toEqual({ user: admin });
});

it("keeps the admin sub-navigation away from members and signed-out visitors", async () => {
    for (const user of [member, null]) {
        mocks.getUser.mockResolvedValue({ data: { user } });
        const html = await renderLayout();

        expect(html).toContain("Site navigation");
        expect(html).toContain("Admin page body");
        expect(html).not.toContain('aria-label="Administration"');
        expect(html).not.toContain("Admin access");
    }
});

it("treats a failed administrator lookup as signed out without throwing", async () => {
    mocks.client.mockRejectedValue(new Error("session unavailable"));
    const html = await renderLayout();

    expect(html).toContain("Admin page body");
    expect(html).not.toContain("Admin access");
    expect(await mocks.navbar.mock.calls[0][0].viewer).toEqual({ user: null });
});

it("lets the navbar show the impersonated user while the original administrator keeps admin navigation", async () => {
    mocks.cookies.set(IMPERSONATION_COOKIE, "selection");
    mocks.getUser.mockResolvedValue({ data: { user: admin } });
    const html = await renderLayout();

    expect(html).toContain("Admin access");
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ impersonation: "actor" });
    expect(mocks.navbar.mock.calls[0][0].viewer).toBeUndefined();
});
