import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), locale: undefined as string | undefined }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
vi.mock("./LocaleSelector", () => ({ LocaleSelector: () => null }));
vi.mock("./ProfileDropdown", () => ({ ProfileDropdown: ({ accountName, isAdmin }: { accountName: string; isAdmin: boolean }) => <span>{accountName}{isAdmin ? " Admin controls" : ""}</span> }));
vi.mock("./MobileNavigation", () => ({ MobileNavigation: ({ accountName }: { accountName: string }) => <span>{accountName}</span> }));
vi.mock("./CommunityDropdown", () => ({ CommunityDropdown: () => null }));
vi.mock("@/app/components/home/modulesection/DownloadModal.tsx", () => ({ DownloadModal: () => null }));
import { Navbar } from "./Navbar";
import { localeDefinitions } from "@/app/lib/localization/registry";
import common from "@/app/lib/localization/dictionaries/en/common.json";

const user: User = { id: "aaaaaaaa-1111-4111-8111-111111111111", aud: "authenticated", created_at: "2026-09-30T00:00:00Z", app_metadata: { role: "Admin" }, user_metadata: { name: "First viewer" } };
beforeEach(() => { vi.resetAllMocks(); mocks.locale = undefined; vi.stubEnv("SUPABASE_ADMIN_EMAILS", ""); });

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

it("passes the localized missing-name fallback to desktop and mobile navigation", async () => {
    const original = localeDefinitions.ru;
    localeDefinitions.ru = { ...original, enabled: true, dictionaries: { common: async () => ({ default: { ...common, "account.defaultName": "Ваш аккаунт" } }) } };
    mocks.locale = "ru";
    try {
        const html = renderToStaticMarkup(await Navbar({ viewer: Promise.resolve({ user: { ...user, user_metadata: {} } }) }));
        expect(html.match(/Ваш аккаунт/g)).toHaveLength(2);
        expect(html).not.toContain("Your account");
        expect(mocks.client).not.toHaveBeenCalled();
    } finally { localeDefinitions.ru = original; }
});

it("does not translate a real display name equal to the English fallback", async () => {
    const original = localeDefinitions.ru;
    localeDefinitions.ru = { ...original, enabled: true, dictionaries: { common: async () => ({ default: { ...common, "account.defaultName": "Ваш аккаунт" } }) } };
    mocks.locale = "ru";
    try {
        const html = renderToStaticMarkup(await Navbar({ viewer: Promise.resolve({ user: { ...user, user_metadata: { display_name: "Your account" } } }) }));
        expect(html.match(/Your account/g)).toHaveLength(2);
        expect(html).not.toContain("Ваш аккаунт");
        expect(mocks.client).not.toHaveBeenCalled();
    } finally { localeDefinitions.ru = original; }
});

it("keeps failed authentication signed out instead of issuing a second request", async () => {
    const html = renderToStaticMarkup(await Navbar({ viewer: Promise.reject(new Error("session unavailable")) }));
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Admin controls");
    expect(mocks.client).not.toHaveBeenCalled();
});
