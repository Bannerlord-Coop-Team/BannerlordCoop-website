import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { createTranslator } from "@/app/lib/localization/translator";
import account from "@/app/lib/localization/dictionaries/en/account.json";
import type { BoostyLinkStatus } from "../../../supabase/functions/_shared/boosty-account";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), cookie: undefined as string | undefined }));
vi.mock("@/app/account/boosty-actions", () => ({ startBoostyLink: vi.fn(), unlinkBoostyAccount: vi.fn() }));
vi.mock("@/app/account/actions", () => ({ linkDiscordAccount: vi.fn(), linkPatreonAccount: vi.fn(), disconnectPatreonAccount: vi.fn(), disconnectDiscordAccount: vi.fn() }));
vi.mock("@/app/account/AccountStatusSync", () => ({ AccountStatusSync: () => null }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "__Host-boosty-link-code" && mocks.cookie ? { value: mocks.cookie } : undefined }) }));
vi.mock("@/app/lib/hosting/website-account-status", () => ({ getWebsiteAccountStatus: async () => null }));
const accountId = "aaaaaaaa-1111-4111-8111-111111111111";
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: accountId, identities: [] } } }), getSession: async () => ({ data: { session: { user: { id: accountId }, access_token: "test-token" } } }) },
    functions: { invoke: mocks.invoke },
}) }));
import { BoostyConnection } from "./BoostyConnection";
import AccountPage from "./page";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); mocks.cookie = undefined; });
const t = createTranslator("en", account).t;
const base: Extract<BoostyLinkStatus, { configured: true }> = { version: 1, configured: true, creatorName: "Coop Team", linked: false, linkState: "unlinked", verification: "unverified", verifiedAt: null, pending: null, outcome: null };

/** Renders the Boosty section with the English dictionary. */
function render(status: typeof base, code: string | null = null, result?: string) {
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(<LocalizationProvider locale="en" messages={{ account }}><BoostyConnection accountId={accountId} status={status} code={code} result={result} t={t} buttonClass="" /></LocalizationProvider>);
    return view;
}

it("offers a code to an unlinked account and shows it with DM instructions only while it is the pending one", () => {
    expect(render(base).textContent).toContain(t("boosty.start"));
    const pending = { ...base, pending: { expiresAt: "2026-11-10T12:30:00.000Z", matches: true } };
    const shown = render(pending, "BLC-AB12C-DE34F");
    expect(shown.querySelector("code")?.textContent).toBe("BLC-AB12C-DE34F");
    // The creator name and the code's UTC expiry reach the instructions; a pending code offers a new one, not a first one.
    expect(shown.textContent).toContain(t("boosty.codeInstructions", { creator: "Coop Team", expiresAt: "12:30 UTC" }));
    expect(shown.textContent).toContain(t("boosty.restart"));
    const lost = render({ ...pending, pending: { ...pending.pending, matches: false } }, "BLC-AB12C-DE34F");
    expect(lost.querySelector("code")).toBeNull();
    expect(lost.textContent).toContain(t("boosty.codeWaiting"));
});

it("explains conflicts and superseded codes, and shows linked verification with disconnect", () => {
    expect(render({ ...base, outcome: "conflict" }).querySelector('[role="alert"]')?.textContent).toBe(t("boosty.conflict"));
    expect(render({ ...base, outcome: "superseded" }).querySelector('[role="alert"]')?.textContent).toBe(t("boosty.superseded"));
    const linked = render({ ...base, linked: true, linkState: "linked", verification: "qualifying" });
    expect(linked.querySelector('[role="status"]')?.textContent).toBe(`${t("boosty.linked")} ${t("membership.verified")}`);
    expect([...linked.querySelectorAll("button")].some(button => button.textContent === t("disconnect.trigger", { provider: "Boosty" }))).toBe(true);
    expect(linked.querySelector("form")).toBeNull();
    expect(render({ ...base, linked: true, linkState: "linked", verification: "unknown" }).textContent).toContain(t("boosty.checking"));
    expect(render(base, null, "error").querySelector('[role="alert"]')?.textContent).toBe(t("boosty.error"));
});

it("the account page reads Boosty status only when enabled and hides the section when unconfigured or unreadable", async () => {
    const page = async () => { const view = document.createElement("div"); view.innerHTML = renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve({}) })); return view; };
    expect((await page()).querySelector("#boosty-heading")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    vi.stubEnv("BOOSTY_LINKING_ENABLED", "true");
    mocks.cookie = "BLC-AB12C-DE34F";
    mocks.invoke.mockResolvedValue({ data: { ...base, pending: { expiresAt: "2026-11-10T12:30:00.000Z", matches: true } }, error: null });
    const enabled = await page();
    expect(enabled.querySelector("#boosty-heading")?.textContent).toBe("Boosty");
    expect(enabled.querySelector("code")?.textContent).toBe("BLC-AB12C-DE34F");
    expect(mocks.invoke).toHaveBeenCalledWith("website-account", { headers: { Authorization: "Bearer test-token" }, body: { operation: "boosty-status", code: "BLC-AB12C-DE34F" } });
    mocks.invoke.mockResolvedValue({ data: { version: 1, configured: false }, error: null });
    expect((await page()).querySelector("#boosty-heading")).toBeNull();
    mocks.invoke.mockResolvedValue({ data: { ...base, providerUserId: "4242" }, error: null });
    expect((await page()).querySelector("#boosty-heading")).toBeNull();
});
