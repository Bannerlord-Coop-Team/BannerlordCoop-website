import type { User } from "@supabase/supabase-js";
import { Children, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hasAdminAccess, hasControlPlaneAdminAccess } from "@/app/lib/auth/access";
import { createControlPlaneAdminHandler } from "../../../../supabase/functions/_shared/control-plane-admin";

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), request: vi.fn(), users: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: { getUser: mocks.user, getSession: mocks.session } }) }));
vi.mock("@/app/lib/supabase/users", () => ({ listDiscordUsers: mocks.users }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<object>(), requestControlPlaneAdmin: mocks.request }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, useRouter: () => ({ refresh: vi.fn() }) }));
import ControlPlaneAdminPage from "./page";

const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "test-access-token-with-enough-characters";
const admin = { id: ACCOUNT_ID, email: "bootstrap@example.test", app_metadata: { role: "Admin" }, user_metadata: {}, identities: [] } as unknown as User;

beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ data: { user: admin } });
    // An old session's user must never authorize this page.
    mocks.session.mockResolvedValue({ data: { session: { access_token: TOKEN, user: admin } } });
    mocks.request.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => vi.unstubAllEnvs());

it("bootstrap-only and spoofed accounts are denied by both the real page and Edge, not unrelated site administration", async () => {
    vi.stubEnv("SUPABASE_ADMIN_EMAILS", admin.email!);
    const user = { ...admin, app_metadata: { role: "User" }, user_metadata: { role: "Admin" } };
    expect(hasAdminAccess(user)).toBe(true);
    expect(hasControlPlaneAdminAccess(user)).toBe(false);
    mocks.user.mockResolvedValue({ data: { user } });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/");
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
    const fetchImplementation = vi.fn(async () => Response.json(user));
    const edge = createControlPlaneAdminHandler({ allowedOrigins: ["https://site.example.test"], supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "test-publishable-key-long-enough", controlPlaneAdminUrl: "https://cp.example.test", fetchImplementation });
    const response = await edge(new Request("https://edge.example.test", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ version: 1, requestId: ACCOUNT_ID, operation: "overview" }) }));
    expect(response.status).toBe(403);
    expect(fetchImplementation).toHaveBeenCalledOnce();
});

it.each([[], [{ provider: "google" }], [{ provider: "email" }], undefined])("admits fresh Auth Admin without Discord identities %j", async (identities) => {
    mocks.user.mockResolvedValue({ data: { user: { ...admin, identities } } });
    const page = await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "audit" }) });
    await renderView(page);
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledWith({ accessToken: TOKEN, operation: "audit", input: { cursor: null, limit: 100 } });
    expect(mocks.users).not.toHaveBeenCalled();
});

it.each(["", "763278507085922325", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", `${ACCOUNT_ID}\n`])("denies malformed verified account id %j before loading CP data", async (id) => {
    mocks.user.mockResolvedValue({ data: { user: { ...admin, id } } });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/");
    expect(mocks.request).not.toHaveBeenCalled();
});

it("requires both verified Auth user and bearer session", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login?next=/admin/control-plane");
    mocks.user.mockResolvedValue({ data: { user: admin } });
    mocks.session.mockResolvedValue({ data: { session: null } });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login?next=/admin/control-plane");
    expect(mocks.request).not.toHaveBeenCalled();
});

it("renders generic audit identity-provider attribution and escapes untrusted actor text", async () => {
    mocks.request.mockResolvedValue({ items: [{ eventId: ACCOUNT_ID, occurredAt: "2026-09-01T00:00:00Z", action: "set-bonus-quota", actorType: "supabase", actorId: ACCOUNT_ID, targetServerId: null, reason: null, correlationId: ACCOUNT_ID }, { eventId: "other", occurredAt: "2026-09-01T00:00:00Z", action: "set-bonus-quota", actorType: "<script>bad</script>", actorId: "<b>bad</b>", targetServerId: null, reason: null, correlationId: null }], nextCursor: null });
    const html = await renderView(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "audit" }) }));
    expect(html).toContain("supabase");
    expect(html).toContain("22222222…222222");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(html).not.toContain("<script>");
});

async function renderView(page: ReactNode) {
    // Resolve the page's async server child before using the synchronous React renderer.
    const suspense = findSuspense(page);
    if (!suspense) throw new Error("Missing control-plane view boundary");
    const child = suspense.props.children as ReactElement;
    const component = child.type as (props: unknown) => Promise<ReactNode>;
    return renderToStaticMarkup(await component(child.props));
}
function findSuspense(node: ReactNode): ReactElement<{ children: ReactNode }> | undefined {
    for (const child of Children.toArray(node)) {
        if (!isValidElement<{ children?: ReactNode }>(child)) continue;
        if (child.type === Suspense) return child as ReactElement<{ children: ReactNode }>;
        const found = findSuspense(child.props.children);
        if (found) return found;
    }
}
