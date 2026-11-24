import { renderToReadableStream } from "react-dom/server";
import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), navbar: vi.fn(), cookies: new Map<string, string>() }));

/** Reads a fixture cookie the way the Next cookie store returns it. */
function fixtureCookie(name: string) {
    if (!mocks.cookies.has(name)) return undefined;
    return { name, value: mocks.cookies.get(name) };
}

vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: mocks.client,
}));
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: fixtureCookie }),
}));
vi.mock("next/navigation", () => ({
    usePathname: () => "/admin/control-plane",
}));
vi.mock("@/app/components/layout/Navbar", () => ({
    Navbar: (props: unknown) => {
        mocks.navbar(props);
        return <header>Site navigation</header>;
    },
}));
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser } });
});
afterEach(() => { vi.restoreAllMocks(); });

it("renders the site navbar, the admin sub-navigation and the page in order for administrators", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: admin } });
    const html = await renderLayout();

    const navbar = html.indexOf("Site navigation");
    const subNav = html.indexOf('aria-label="Administration"');
    const body = html.indexOf("Admin page body");
    expect(navbar).toBeGreaterThan(-1);
    expect(subNav).toBeGreaterThan(navbar);
    expect(body).toBeGreaterThan(subNav);
    expect(html).toContain("Admin access");
    const page = document.createElement("div");
    page.innerHTML = html;
    const active = page.querySelector('nav[aria-label="Administration"] a[aria-current="page"]');
    expect(active?.getAttribute("href")).toBe("/admin/control-plane");
    expect(active?.textContent?.trim()).toBe("Control Plane");
    expect(page.querySelectorAll("main")).toHaveLength(1);
});

it("shares the administrator lookup with the navbar instead of authenticating twice", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: admin } });
    await renderLayout();

    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ impersonation: "actor" });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(await mocks.navbar.mock.calls[0][0].viewer).toEqual({ user: admin });
});

it.each([["member", member], ["signed-out", null]])("keeps the admin sub-navigation away from a %s viewer", async (_label, user) => {
    mocks.getUser.mockResolvedValue({ data: { user } });
    const html = await renderLayout();

    expect(html).toContain("Site navigation");
    expect(html).toContain("Admin page body");
    expect(html).not.toContain('aria-label="Administration"');
    expect(html).not.toContain("Admin access");
});

it("logs a failed administrator lookup and renders signed out without throwing", async () => {
    const failure = new Error("session unavailable");
    mocks.client.mockRejectedValue(failure);
    const html = await renderLayout();

    expect(html).toContain("Admin page body");
    expect(html).not.toContain("Admin access");
    expect(await mocks.navbar.mock.calls[0][0].viewer).toEqual({ user: null });
    expect(console.error).toHaveBeenCalledWith("Admin navigation viewer failed to load", failure);
});

it("lets the navbar resolve the impersonated user when the administrator lookup fails mid-impersonation", async () => {
    mocks.cookies.set(IMPERSONATION_COOKIE, "selection");
    mocks.client.mockRejectedValue(new Error("backup session unavailable"));
    const html = await renderLayout();

    expect(html).toContain("Admin page body");
    expect(html).not.toContain("Admin access");
    expect(mocks.navbar.mock.calls[0][0].viewer).toBeUndefined();
});

it("lets the navbar show the impersonated user while the original administrator keeps admin navigation", async () => {
    mocks.cookies.set(IMPERSONATION_COOKIE, "selection");
    mocks.getUser.mockResolvedValue({ data: { user: admin } });
    const html = await renderLayout();

    expect(html).toContain("Admin access");
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ impersonation: "actor" });
    expect(mocks.navbar.mock.calls[0][0].viewer).toBeUndefined();
});
