import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { createTranslator } from "@/app/lib/localization/translator";
import account from "@/app/lib/localization/dictionaries/en/account.json";
import type { BoostyStatus } from "../../../supabase/functions/_shared/boosty-account";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/app/account/actions", () => ({ linkDiscordAccount: vi.fn(), linkPatreonAccount: vi.fn(), disconnectPatreonAccount: vi.fn(), disconnectDiscordAccount: vi.fn() }));
vi.mock("@/app/account/AccountStatusSync", () => ({ AccountStatusSync: () => null }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/app/lib/hosting/website-account-status", () => ({ getWebsiteAccountStatus: async () => null }));
const accountId = "aaaaaaaa-1111-4111-8111-111111111111";
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: accountId, identities: [] } } }), getSession: async () => ({ data: { session: { user: { id: accountId }, access_token: "test-token" } } }) },
    functions: { invoke: mocks.invoke },
}) }));
import { BoostyConnection } from "./BoostyConnection";
import AccountPage from "./page";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const t = createTranslator("en", account).t;
const base: Extract<BoostyStatus, { configured: true }> = { version: 1, configured: true, linked: false, verification: "unverified" };

/** Renders the Boosty section with the English dictionary. */
function render(status: typeof base) {
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(<LocalizationProvider locale="en" messages={{ account }}><BoostyConnection status={status} t={t} /></LocalizationProvider>);
    return view;
}

it("shows a read-only status: how to link by email, or the linked verification, with no actions", () => {
    const unlinked = render(base);
    expect(unlinked.querySelector('[role="status"]')?.textContent).toBe(t("boosty.notFound"));
    expect(unlinked.querySelector("form, button")).toBeNull();
    const linked = render({ ...base, linked: true, verification: "qualifying" });
    expect(linked.querySelector('[role="status"]')?.textContent).toBe(`${t("boosty.linked")} ${t("membership.verified")}`);
    expect(linked.querySelector("form, button")).toBeNull();
    expect(render({ ...base, linked: true, verification: "nonqualifying" }).textContent).toContain(t("boosty.nonqualifying"));
    expect(render({ ...base, linked: true, verification: "unknown" }).textContent).toContain(t("boosty.checking"));
});

it("the account page reads Boosty status only when enabled and shows it only when the Edge reports it configured", async () => {
    const page = async () => { const view = document.createElement("div"); view.innerHTML = renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve({}) })); return view; };
    expect((await page()).querySelector("#boosty-heading")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    vi.stubEnv("BOOSTY_STATUS_ENABLED", "true");
    mocks.invoke.mockResolvedValue({ data: { ...base, linked: true, verification: "qualifying" }, error: null });
    expect((await page()).querySelector("#boosty-heading")?.textContent).toBe("Boosty");
    expect(mocks.invoke).toHaveBeenCalledWith("website-account", { headers: { Authorization: "Bearer test-token" }, body: { operation: "boosty-status" } });
    mocks.invoke.mockResolvedValue({ data: { version: 1, configured: false }, error: null });
    expect((await page()).querySelector("#boosty-heading")).toBeNull();
    mocks.invoke.mockResolvedValue({ data: { ...base, providerUserId: "4242" }, error: null });
    expect((await page()).querySelector("#boosty-heading")).toBeNull();
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("down") });
    expect((await page()).querySelector("#boosty-heading")).toBeNull();
});
