import { afterEach, expect, it, vi } from "vitest";
import AccountPage, * as accountPage from "./page";

vi.mock("@/app/account/actions", () => ({ linkPatreonAccount: vi.fn() }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));

afterEach(() => vi.unstubAllEnvs());

it("request-renders /account instead of prerendering Supabase authentication at build time", () => {
    expect(accountPage).toHaveProperty("dynamic", "force-dynamic");
});

it("still rejects account requests when runtime Supabase configuration is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);

    await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
        "Supabase authentication is not configured.",
    );
});
