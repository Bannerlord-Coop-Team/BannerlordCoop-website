import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn() }));

vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: mocks.client,
}));
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    usePathname: () => "/admin/control-plane",
}));
vi.mock("@/app/components/layout/Navbar", () => ({
    Navbar: () => <header>Site navigation</header>,
}));
import AdminLayout from "./layout";

const admin = { id: "11111111-1111-4111-8111-111111111111", app_metadata: { role: "Admin" }, user_metadata: {} } as unknown as User;
const member = { id: "22222222-2222-4222-8222-222222222222", app_metadata: { role: "User" }, user_metadata: {} } as unknown as User;

/** Streams the layout to completion around a stand-in page body. */
async function renderLayout() {
    const stream = await renderToReadableStream(await AdminLayout({ children: <main>Admin page body</main> }));
    await stream.allReady;
    return new Response(stream).text();
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SUPABASE_ADMIN_EMAILS", "");
    mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser } });
});

it("renders the site navbar, the admin sub-navigation and the page in order for administrators", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: admin }, error: null });
    const html = await renderLayout();

    const navbar = html.indexOf("Site navigation");
    const subNav = html.indexOf('aria-label="Administration"');
    const body = html.indexOf("Admin page body");
    expect(navbar).toBeGreaterThan(-1);
    expect(subNav).toBeGreaterThan(navbar);
    expect(body).toBeGreaterThan(subNav);
    expect(html).toContain("Admin access");
    expect(html.match(/<main/g)).toHaveLength(1);
});

it("renders the page behind a localized navbar placeholder while the identity is still loading", async () => {
    mocks.getUser.mockReturnValue(new Promise(() => {}));
    // The synchronous renderer emits Suspense fallbacks for content that has not resolved yet.
    const shell = renderToStaticMarkup(await AdminLayout({ children: <main>Admin page body</main> }));

    expect(shell).toContain('role="status" aria-label="Loading navigation"');
    expect(shell).toContain("Admin page body");
    expect(shell).not.toContain("Site navigation");
});

it.each([["member", member], ["signed-out", null]])("keeps the admin sub-navigation away from a %s viewer", async (_label, user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    const html = await renderLayout();

    expect(html).toContain("Site navigation");
    expect(html).toContain("Admin page body");
    expect(html).not.toContain('aria-label="Administration"');
    expect(html).not.toContain("Admin access");
});
