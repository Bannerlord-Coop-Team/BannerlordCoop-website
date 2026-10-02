import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { createTranslator } from "@/app/lib/localization/translator";
import account from "@/app/lib/localization/dictionaries/en/account.json";
import { EMPTY_MEMBERSHIP, type AccountStatus } from "@/app/lib/hosting/membership-onboarding";
import { DisconnectAccount } from "./DisconnectAccount";

const mocks = vi.hoisted(() => ({ status: vi.fn(), user: vi.fn(), pending: false }));
// Synthetic messages prove dictionary consumption without enabling an unfinished locale.
const translated = Object.fromEntries(Object.entries(account).map(([key, value]) => [key, `訳:${key} ${value}`]));
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "ja",
    getTranslations: async () => createTranslator("ja", translated),
    getMessages: async () => ({ account: translated }),
}));
vi.mock("@/app/account/AccountStatusSync", () => ({ AccountStatusSync: () => null }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("@/app/account/actions", () => ({ linkDiscordAccount: vi.fn(), linkPatreonAccount: vi.fn(), disconnectPatreonAccount: vi.fn(), disconnectDiscordAccount: vi.fn() }));
vi.mock("react-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-dom")>(), useFormStatus: () => ({ pending: mocks.pending }) }));
vi.mock("@/app/lib/hosting/website-account-status", () => ({ getWebsiteAccountStatus: mocks.status }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: {
    getUser: mocks.user,
    getSession: async () => ({ data: { session: { user: { id: "account-id" }, access_token: "test-token" } } }),
} }) }));
import AccountPage, { generateMetadata } from "./page";
import AccountLoading from "./loading";

afterEach(() => { vi.resetAllMocks(); mocks.pending = false; });

/** Builds a complete authoritative account status for the presentation under test. */
function accountStatus(hasDiscord: boolean, membership: AccountStatus["membership"] = EMPTY_MEMBERSHIP): AccountStatus {
    return { version: 1, accountId: "account-id", hasDiscord, configured: true, verificationPending: false, membership };
}

/** Renders one account presentation snapshot with authoritative mocked status and unchanged names. */
async function renderAccount(status: AccountStatus | null, params: { discord?: string; patreon?: string } = {}, named = true) {
    mocks.user.mockResolvedValue({ data: { user: { id: "account-id", user_metadata: named ? { full_name: "Actual Name" } : {}, identities: [
        { provider: "discord", identity_id: "identity-id", identity_data: { preferred_username: "actual_discord" } },
        { provider: "email", identity_id: "email-id" },
    ] } } });
    mocks.status.mockResolvedValue(status);
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve(params) }));
    return view;
}

it("uses selected messages for metadata and accessible loading", async () => {
    expect(await generateMetadata()).toEqual({ title: translated["metadata.title"] });
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(await AccountLoading());
    expect(view.querySelector('[aria-busy="true"]')?.getAttribute("aria-label")).toBe(translated["loading.label"]);
    expect(view.querySelector('[role="status"]')?.textContent?.trim()).toBe(translated["loading.status"]);
});

it.each([true, false])("localizes unlinked presentation and only the missing-name fallback (named=%s)", async named => {
    const view = await renderAccount(accountStatus(false), {}, named);
    for (const key of ["heading", "intro", "connections.heading", "badge.unlinked", "discord.optional", "discord.connect", "patreon.benefits", "patreon.connect", "servers.heading", "servers.description", "servers.link"]) {
        expect(view.textContent).toContain(translated[key]);
    }
    expect(view.textContent).toContain(named ? "Actual Name" : translated.defaultName);
    expect(view.textContent?.includes(translated.defaultName)).toBe(!named);
    expect(view.querySelector('a[href="/servers"]')).not.toBeNull();
    expect([...view.querySelectorAll('input[name="returnPath"]')].map(input => input.getAttribute("value"))).toEqual(["/account", "/account"]);
});

it("localizes unavailable status without offering connection operations", async () => {
    const view = await renderAccount(null);
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(translated["status.unavailable"]);
    expect(view.textContent).toContain(translated["badge.unavailable"]);
    expect(view.querySelector("form")).toBeNull();
});

it.each([
    ["discord", "rate_limited", "error.rateLimited"], ["patreon", "rate_limited", "error.rateLimited"],
    ["discord", "retry", "error.retry"], ["patreon", "retry", "error.retry"],
    ["discord", "last_identity", "error.lastIdentity"], ["discord", "disconnect_error", "error.discordDisconnect"],
    ["patreon", "disconnect_error", "error.patreonDisconnect"], ["discord", "repair", "error.discordRepair"],
    ["patreon", "error", "error.patreonAuthorization"], ["patreon", "confirm_error", "error.patreonAuthorization"],
    ["patreon", "cancelled", "error.patreonAuthorization"],
])("localizes %s=%s error presentation", async (provider, code, key) => {
    const view = await renderAccount(accountStatus(false), { [provider]: code });
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(translated[key]);
    expect(view.textContent).toContain(translated["patreon.connect"]);
});

it.each([
    ["qualifying", "2099-01-01T00:00:00Z", "pending", "membership.verified", "membership.syncPending"],
    ["qualifying", "2000-01-01T00:00:00Z", "unavailable", "membership.verifyRequired", "membership.syncUnavailable"],
    ["nonqualifying", null, "pending", "membership.nonqualifying", "membership.syncPending"],
    ["review_required", null, "unavailable", "membership.reviewRequired", "membership.syncUnavailable"],
] as const)("localizes linked membership %s notices without translating actual Discord names", async (verification, validUntil, sync, verificationKey, syncKey) => {
    const view = await renderAccount(accountStatus(true, { ...EMPTY_MEMBERSHIP, linked: true, verification, validUntil, sync }));
    for (const key of [verificationKey, syncKey, "membership.expiry", "badge.connected", "patreon.linked", "patreon.verify"]) {
        expect(view.textContent).toContain(translated[key]);
    }
    expect(view.textContent).toContain("actual_discord");
    expect(view.textContent).not.toContain(translated["discord.connected"]);
});

it.each(["Discord", "Patreon"] as const)("localizes %s disconnect confirmation and pending accessibility", async provider => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    const action = vi.fn(async () => {});
    const { t } = createTranslator("ja", translated);
    /** Supplies the selected account messages while preserving the action and provider value. */
    function Control() {
        return <LocalizationProvider locale="ja" messages={{ account: translated }}><DisconnectAccount provider={provider} action={action} /></LocalizationProvider>;
    }
    try {
        await act(async () => root.render(<Control />));
        expect(container.querySelector("button")?.textContent?.trim()).toBe(t("disconnect.trigger", { provider }));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain(t(provider === "Discord" ? "disconnect.discordExplanation" : "disconnect.patreonExplanation"));
        expect(container.textContent).toContain(t("disconnect.confirm", { provider }));
        expect(container.textContent).toContain(t("disconnect.cancel"));
        mocks.pending = true;
        await act(async () => root.render(<Control />));
        expect(container.querySelector('[role="status"]')?.textContent?.trim()).toBe(t("disconnect.pending", { provider }));
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
        expect(action).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
    }
});
