import { renderToReadableStream } from "react-dom/server";
import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_MEMBERSHIP } from "@/app/lib/hosting/membership-onboarding";

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), session: vi.fn(), status: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.client }));
vi.mock("@/app/lib/hosting/website-account-status", () => ({ getWebsiteAccountStatus: mocks.status }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/app/account/AccountStatusSync", () => ({ AccountStatusSync: ({ pending }: { pending: boolean }) => <span data-status-pending={pending} /> }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("@/app/components/layout/LocaleSelector", () => ({ LocaleSelector: () => null }));
vi.mock("@/app/components/layout/ProfileDropdown", () => ({ ProfileDropdown: ({ accountName, isAdmin }: { accountName: string; isAdmin: boolean }) => <nav>{`${accountName}${isAdmin ? " Admin controls" : ""}`}</nav> }));
vi.mock("@/app/components/layout/MobileNavigation", () => ({ MobileNavigation: () => null }));
vi.mock("@/app/components/layout/CommunityDropdown", () => ({ CommunityDropdown: () => null }));
vi.mock("@/app/components/home/modulesection/DownloadModal.tsx", () => ({ DownloadModal: () => null }));
vi.mock("@/app/account/actions", () => ({ linkDiscordAccount: vi.fn(), linkPatreonAccount: vi.fn(), disconnectPatreonAccount: vi.fn(), disconnectDiscordAccount: vi.fn() }));
import AccountPage from "./page";

const user: User = { id: "aaaaaaaa-1111-4111-8111-111111111111", aud: "authenticated", created_at: "2026-09-30T00:00:00Z", app_metadata: { role: "Admin" }, user_metadata: { name: "First viewer" } };
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SUPABASE_ADMIN_EMAILS", "");
    mocks.client.mockResolvedValue({ auth: { getUser: mocks.user, getSession: mocks.session } });
    mocks.user.mockResolvedValue({ data: { user } });
    mocks.session.mockResolvedValue({ data: { session: { user, access_token: "test-page-token" } } });
    mocks.status.mockResolvedValue({ version: 1, accountId: user.id, hasDiscord: false, configured: true, verificationPending: false, membership: EMPTY_MEMBERSHIP });
});
afterEach(() => vi.unstubAllEnvs());

async function renderPage() {
    const stream = await renderToReadableStream(await AccountPage({ searchParams: Promise.resolve({ discord: "last_identity" }) }));
    await stream.allReady;
    return new Response(stream).text();
}

it("renders the real page and Navbar with one freshly verified viewer", async () => {
    const html = await renderPage();
    expect(html).toContain("<nav>First viewer Admin controls</nav>");
    expect(mocks.client).toHaveBeenCalledOnce();
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith(user.id, "test-page-token");
});

it("reads a changed account and role afresh, then redirects a signed-out render", async () => {
    await renderPage();
    const nextUser = { ...user, id: "bbbbbbbb-2222-4222-8222-222222222222", app_metadata: { role: "User" }, user_metadata: { name: "Next viewer" } };
    mocks.user.mockResolvedValue({ data: { user: nextUser } });
    mocks.session.mockResolvedValue({ data: { session: { user: nextUser, access_token: "next-page-token" } } });
    mocks.status.mockResolvedValue({ version: 1, accountId: nextUser.id, hasDiscord: false, configured: true, verificationPending: false, membership: EMPTY_MEMBERSHIP });
    const html = await renderPage();
    expect(html).toContain("<nav>Next viewer</nav>");
    expect(html).not.toContain("First viewer");
    expect(html).not.toContain("Admin controls");
    expect(mocks.client).toHaveBeenCalledTimes(2);
    expect(mocks.user).toHaveBeenCalledTimes(2);
    expect(mocks.status).toHaveBeenLastCalledWith(nextUser.id, "next-page-token");

    mocks.user.mockResolvedValue({ data: { user: null } });
    await expect(renderPage()).rejects.toThrow("redirect:/login?next=/account");
    expect(mocks.user).toHaveBeenCalledTimes(3);
    expect(mocks.status).toHaveBeenCalledTimes(2);
});

it.each(["unavailable", "session_changed", "session_missing"])("keeps unknown status pending and the verified viewer when %s", async scenario => {
    if (scenario === "unavailable") mocks.status.mockRejectedValue(new Error("Status unavailable"));
    if (scenario === "session_changed") mocks.session.mockResolvedValue({ data: { session: { user: { id: "other-account" }, access_token: "other-token" } } });
    if (scenario === "session_missing") mocks.session.mockResolvedValue({ data: { session: null } });
    const html = await renderPage();
    expect(html).toContain("<nav>First viewer Admin controls</nav>");
    expect(html).toContain('data-status-pending="true"');
    expect(mocks.client).toHaveBeenCalledOnce();
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.status).toHaveBeenCalledTimes(scenario === "unavailable" ? 1 : 0);
});
