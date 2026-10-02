import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./LocaleSelector", () => ({ LocaleSelector: () => null }));
vi.mock("./ProfileDropdown", () => ({ ProfileDropdown: ({ accountName, isAdmin }: { accountName: string; isAdmin: boolean }) => <span>{accountName}{isAdmin ? " Admin controls" : ""}</span> }));
vi.mock("./MobileNavigation", () => ({ MobileNavigation: () => null }));
vi.mock("./CommunityDropdown", () => ({ CommunityDropdown: () => null }));
vi.mock("@/app/components/home/modulesection/DownloadModal.tsx", () => ({ DownloadModal: () => null }));
import { Navbar } from "./Navbar";

const user: User = { id: "aaaaaaaa-1111-4111-8111-111111111111", aud: "authenticated", created_at: "2026-09-30T00:00:00Z", app_metadata: { role: "Admin" }, user_metadata: { name: "First viewer" } };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SUPABASE_ADMIN_EMAILS", ""); });

it("uses the page's verified viewer without another authentication request", async () => {
    const html = renderToStaticMarkup(await Navbar({ viewer: Promise.resolve({ user }) }));
    expect(html).toContain("First viewer");
    expect(html).toContain("Admin controls");
    expect(mocks.client).not.toHaveBeenCalled();
});

it("does not retain a previous render's user or administrator role", async () => {
    await Navbar({ viewer: Promise.resolve({ user }) });
    const html = renderToStaticMarkup(await Navbar({ viewer: Promise.resolve({ user: { ...user, app_metadata: { role: "User" }, user_metadata: { name: "Next viewer" } } }) }));
    expect(html).toContain("Next viewer");
    expect(html).not.toContain("First viewer");
    expect(html).not.toContain("Admin controls");
    const signedOut = renderToStaticMarkup(await Navbar({ viewer: Promise.resolve({ user: null }) }));
    expect(signedOut).toContain("Sign in");
    expect(signedOut).not.toContain("Next viewer");
    expect(mocks.client).not.toHaveBeenCalled();
});

it("still verifies authentication for pages without a shared viewer", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user } });
    mocks.client.mockResolvedValue({ auth: { getUser } });
    const html = renderToStaticMarkup(await Navbar());
    expect(html).toContain("First viewer");
    expect(mocks.client).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledOnce();
});

it("keeps failed authentication signed out instead of issuing a second request", async () => {
    const html = renderToStaticMarkup(await Navbar({ viewer: Promise.reject(new Error("session unavailable")) }));
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Admin controls");
    expect(mocks.client).not.toHaveBeenCalled();
});
