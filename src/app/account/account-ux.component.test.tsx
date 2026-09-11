import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_MEMBERSHIP } from "@/app/lib/hosting/membership-onboarding";
import { accountDisplayName, discordDisplayName } from "@/app/lib/auth/account-display";

const mocks = vi.hoisted(() => ({ status: vi.fn(), recovery: vi.fn() }));
vi.mock("@/app/account/PatreonAutoCompletion", () => ({ PatreonAutoCompletion: () => <p>Automatic completion</p> }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("@/app/account/actions", () => ({ automaticallyCompletePatreonAccount: vi.fn(), resolveAccountLink: vi.fn(), completePatreonAccount: vi.fn(), confirmDiscordAccount: vi.fn(), linkDiscordAccount: vi.fn(), linkPatreonAccount: vi.fn(), unlinkPatreonAccount: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/app/lib/hosting/website-account-status", () => ({ getWebsiteAccountStatus: mocks.status }));
const accountId = "aaaaaaaa-1111-4111-8111-111111111111";
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({
    auth: {
        getUser: async () => ({ data: { user: { id: accountId, user_metadata: { full_name: "Andrew" }, identities: [{ provider: "discord", identity_data: { preferred_username: "andrew_discord" } }] } } }),
        getSession: async () => ({ data: { session: { user: { id: accountId }, access_token: "test" } } }),
    },
    functions: { invoke: async (_name: string, options: { body: { provider: string } }) => ({ data: mocks.recovery(options.body.provider) ?? { accountId, provider: options.body.provider, state: "none" }, error: null }) },
}) }));
import AccountPage from "./page";

afterEach(() => vi.resetAllMocks());
async function render(membership = EMPTY_MEMBERSHIP, params: { patreon?: string } = {}) {
    mocks.status.mockResolvedValue({ hasDiscord: true, membership });
    const element = document.createElement("div");
    element.innerHTML = renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve(params) }));
    return element;
}
it("shows account and provider names, a clear next action, and no permanent help or refresh", async () => {
    const view = await render();
    expect(view.textContent).toContain("Andrew");
    expect(view.textContent).toContain("andrew_discord");
    expect(view.textContent).toContain("Connect Patreon");
    expect(view.textContent).not.toContain("Need help connecting");
    expect(view.textContent).not.toContain("Check status");
    expect(view.textContent).not.toContain("Verification: unknown");
    expect(view.querySelector('a[href="/servers"]')?.textContent).toContain("My Servers");
});
it("shows contextual synchronization feedback and keeps unlink behind disclosure", async () => {
    const view = await render({ ...EMPTY_MEMBERSHIP, linked: true, sync: "pending" });
    expect(view.textContent).toContain("Your server allowance is updating.");
    expect(view.textContent).toContain("Check status");
    expect(view.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(view.querySelector("details")?.textContent).toContain("Confirm unlink Patreon");
});
it("does not claim expired qualifying verification is current", async () => {
    const view = await render({ ...EMPTY_MEMBERSHIP, linked: true, verification: "qualifying", validUntil: "2000-01-01T00:00:00Z" });
    expect(view.textContent).not.toContain("Membership verified.");
    expect(view.textContent).toContain("Verify your membership before creating a new server.");
});
it("automatically completes only a verified live callback, not an arbitrary query or retry landing", async () => {
    expect((await render(EMPTY_MEMBERSHIP, { patreon: "confirm" })).textContent).not.toContain("Automatic completion");
    mocks.recovery.mockImplementation(provider => provider === "patreon" ? { accountId, provider, state: "live", operationId: "eeeeeeee-1111-4111-8111-111111111111", confirmable: true, returnPath: "/account" } : undefined);
    expect((await render(EMPTY_MEMBERSHIP, { patreon: "confirm" })).textContent).toContain("Automatic completion");
    const retry = await render(EMPTY_MEMBERSHIP, { patreon: "confirm_error" });
    expect(retry.textContent).not.toContain("Automatic completion");
    expect(retry.textContent).toContain("Retry connecting Patreon");
});
it("uses safe name fallbacks without exposing email or confusing provider identity", () => {
    expect(accountDisplayName({ user_metadata: { full_name: "  Andrew  " } })).toBe("Andrew");
    expect(accountDisplayName({ user_metadata: { full_name: {}, name: "", email: "private@example.com" } })).toBe("Your account");
    expect(discordDisplayName({ identities: [] })).toBeNull();
});
