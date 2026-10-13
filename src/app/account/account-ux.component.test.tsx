import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EMPTY_MEMBERSHIP } from "@/app/lib/hosting/membership-onboarding";
import { accountDisplayName, discordDisplayName } from "@/app/lib/auth/account-display";

const mocks = vi.hoisted(() => ({ status: vi.fn(), invoke: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/app/account/AccountStatusSync", async importOriginal => {
    const { AccountStatusSync } = await importOriginal<typeof import("./AccountStatusSync")>();
    return { AccountStatusSync: ({ pending }: { pending: boolean }) => <><span data-status-pending={pending} /><AccountStatusSync pending={pending} /></> };
});
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("@/app/account/actions", () => ({ linkDiscordAccount: vi.fn(), linkPatreonAccount: vi.fn(), disconnectPatreonAccount: vi.fn(), disconnectDiscordAccount: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/app/lib/hosting/website-account-status", () => ({ getWebsiteAccountStatus: mocks.status }));
const accountId = "aaaaaaaa-1111-4111-8111-111111111111";
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({
    auth: {
        getUser: async () => ({ data: { user: { id: accountId, user_metadata: { full_name: "Andrew" }, identities: [{ provider: "discord", identity_id: "discord-identity", identity_data: { preferred_username: "andrew_discord" } }] } } }),
        getSession: async () => ({ data: { session: { user: { id: accountId }, access_token: "test" } } }),
    },
    functions: { invoke: mocks.invoke },
}) }));
import AccountPage from "./page";

afterEach(() => vi.resetAllMocks());
async function render(membership = EMPTY_MEMBERSHIP, params: { patreon?: string; discord?: string } = {}, hasDiscord = true, verificationPending = false) {
    mocks.status.mockResolvedValue({ hasDiscord, membership, verificationPending });
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
it("shows contextual synchronization feedback and visible disconnect controls", async () => {
    const view = await render({ ...EMPTY_MEMBERSHIP, linked: true, sync: "pending" });
    expect(view.textContent).toContain("Your server allowance is updating.");
    expect(view.textContent).not.toContain("Check status");
    expect(view.querySelector('[data-status-pending="true"]')).not.toBeNull();
    expect([...view.querySelectorAll("button")].some(button => button.textContent === "Disconnect Patreon")).toBe(true);
    expect(view.textContent).not.toContain("Confirm disconnect Patreon");
});
it("does not claim expired qualifying verification is current", async () => {
    const view = await render({ ...EMPTY_MEMBERSHIP, linked: true, verification: "qualifying", validUntil: "2000-01-01T00:00:00Z" });
    expect(view.textContent).not.toContain("Membership verified.");
    expect(view.textContent).toContain("Verify your membership before creating a new server.");
});
it.each(["confirm", "linked", "error", "confirm_error"])("query %s neither completes nor hides reconnect", async patreon => {
    const view = await render(EMPTY_MEMBERSHIP, { patreon });
    expect(view.textContent).toContain("Connect Patreon");
    expect(view.textContent).not.toMatch(/Recover|Resolve|Retry connecting|Finishing/);
    expect(mocks.invoke).not.toHaveBeenCalled();
});
it.each([
    { discord: "last_identity" }, { discord: "disconnect_error" }, { discord: "repair" },
    { discord: "rate_limited" }, { discord: "retry" }, { discord: "disconnected" },
    { patreon: "error" }, { patreon: "confirm_error" }, { patreon: "cancelled" },
    { patreon: "disconnect_error" }, { patreon: "rate_limited" }, { patreon: "retry" },
    { patreon: "linked" }, { patreon: "unlinked" }, { patreon: "unknown" },
])("does not poll settled status because of OAuth result %j", async params => {
    for (const membership of [EMPTY_MEMBERSHIP, { ...EMPTY_MEMBERSHIP, linked: true, sync: "applied" as const }]) {
        const view = await render(membership, params);
        expect(view.querySelector('[data-status-pending="false"]')).not.toBeNull();
        if (params.discord === "last_identity") expect(view.textContent).toContain("Connect another sign-in method before disconnecting it.");
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
});
it.each([true, false])("polls durable membership synchronization even after a terminal OAuth result (linked=%s)", async linked => {
    for (const params of [{}, { discord: "last_identity" }]) {
        const view = await render({ ...EMPTY_MEMBERSHIP, linked, sync: "pending" }, params);
        expect(view.querySelector('[data-status-pending="true"]')).not.toBeNull();
    }
});
it("polls unavailable linked membership and durable verification without a query flag", async () => {
    const unavailable = await render({ ...EMPTY_MEMBERSHIP, linked: true, sync: "unavailable" });
    expect(unavailable.querySelector('[data-status-pending="true"]')).not.toBeNull();
    const verifying = await render(EMPTY_MEMBERSHIP, {}, true, true);
    expect(verifying.querySelector('[data-status-pending="true"]')).not.toBeNull();
});
it("settled last_identity schedules zero refreshes over a minute but still refreshes on focus and online", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    const interval = vi.spyOn(window, "setInterval");
    const root = createRoot(document.createElement("div"));
    mocks.status.mockResolvedValue({ hasDiscord: true, membership: EMPTY_MEMBERSHIP, verificationPending: false });
    try {
        const page = await AccountPage({ searchParams: Promise.resolve({ discord: "last_identity" }) });
        await act(async () => root.render(page));
        expect(interval).not.toHaveBeenCalled();
        for (let i = 0; i < 12; i++) await act(async () => vi.advanceTimersByTime(5_000));
        expect(mocks.router.refresh).not.toHaveBeenCalled();
        await act(async () => window.dispatchEvent(new Event("focus")));
        await act(async () => window.dispatchEvent(new Event("online")));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
        expect(mocks.invoke).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); interval.mockRestore(); vi.useRealTimers(); }
});
it("initial link and disconnect/reconnect expose Connect solely from current status", async () => {
    for (const hasDiscord of [false, true, false]) {
        const view = await render({ ...EMPTY_MEMBERSHIP, linked: hasDiscord }, {}, hasDiscord);
        expect(view.textContent?.includes("Confirm and connect Discord")).toBe(!hasDiscord);
        expect(view.textContent?.includes("Connect Patreon")).toBe(!hasDiscord);
        expect(view.textContent?.includes("Verify with Patreon")).toBe(hasDiscord);
        expect(view.textContent).not.toMatch(/Recover|Resolve|Cancel pending/);
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
});
it("uses safe name fallbacks without exposing email or confusing provider identity", () => {
    expect(accountDisplayName({ user_metadata: { full_name: "  Andrew  " } })).toBe("Andrew");
    expect(accountDisplayName({ user_metadata: { full_name: {}, name: "", email: "private@example.com" } })).toBe("Your account");
    expect(discordDisplayName({ identities: [] })).toBeNull();
});
