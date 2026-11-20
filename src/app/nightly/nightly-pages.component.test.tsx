import { readFileSync } from "node:fs";
import { LocalizationProvider } from "@/app/lib/localization/client";
import common from "@/app/lib/localization/dictionaries/en/common.json";
import { locales, type Locale } from "@/app/lib/localization/types";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { NightlyClient } from "@/app/lib/nightly/client";
import { encodeClaimContext } from "@/app/lib/nightly/cookies";

const mocks = vi.hoisted(() => ({
    cookies: new Map<string, string>(),
    setCookie: vi.fn(),
    redirect: vi.fn((location: string) => { throw new Error(`redirect:${location}`); }),
    client: {} as Partial<NightlyClient>,
}));
vi.mock("next/headers", () => ({
    cookies: async () => ({
        get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined),
        set: mocks.setCookie,
    }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/app/lib/nightly/server", () => ({ getNightlyClient: () => mocks.client }));
vi.mock("@/app/nightly/claim/actions", () => ({ claimSponsorSeat: vi.fn() }));
vi.mock("@/app/nightly/sponsor/actions", () => ({ createSponsorCode: vi.fn(), removeSponsoredSeat: vi.fn() }));

import { carryOut } from "./action-effects";
import SponsorClaimPage from "./claim/page";
import NightlyErrorPage from "./error/page";
import NightlyAccessPage from "./page";
import SponsorPage from "./sponsor/page";

const SESSION = "s".repeat(43);
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

afterEach(() => {
    mocks.cookies.clear();
    mocks.client = {};
    vi.clearAllMocks();
});

/** Renders a server page element into a detached DOM node. */
function render(element: React.ReactElement, locale: Locale = "en", dictionary = common): HTMLDivElement {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<LocalizationProvider locale={locale} messages={{ common: dictionary }}>{element}</LocalizationProvider>);
    return container;
}

/** Wraps search params the way the App Router passes them. */
function params(values: Record<string, string> = {}) {
    return { searchParams: Promise.resolve(values) };
}

it("landing page links the installers on the gateway host and the sponsor portal", () => {
    const view = render(<NightlyAccessPage />);
    const hrefs = [...view.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
        "https://nightly.bannerlordcoop.com/install.cmd",
        "https://nightly.bannerlordcoop.com/install.sh",
        "/nightly/sponsor",
        "https://discord.gg/bannerlordcoop",
    ]);
});

it("error page renders only canned copy for the context and code", async () => {
    const expired = render(await NightlyErrorPage(params({ context: "activate", code: "expired" })));
    expect(expired.querySelector('[role="alert"]')?.textContent).toBe("That installer code has expired.");
    const role = render(await NightlyErrorPage(params({ context: "callback", code: "supporter_role_required" })));
    expect(role.textContent).toContain("Have a sponsor code?");
    const forged = render(await NightlyErrorPage(params({ context: "<script>", code: "<img src=x onerror=alert(1)>" })));
    expect(forged.querySelector("img, script")).toBeNull();
    expect(forged.querySelector('[role="alert"]')?.textContent).toBe("Access could not be verified. Run the installer again.");
    for (const page of [expired, role, forged]) {
        const link = page.querySelector('a[href="https://discord.gg/5vJzfz5Zzy"]');
        expect(link?.textContent).toBe("our Discord");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
        expect(page.textContent).toContain("Create a General Help support ticket");
    }
});

it.each(locales)("uses the selected %s ticket guidance and link label on the error page", async locale => {
    const dictionary = JSON.parse(readFileSync(`src/app/lib/localization/dictionaries/${locale}/common.json`, "utf8")) as typeof common;
    const view = render(await NightlyErrorPage(params({ context: "activate", code: "expired" })), locale, dictionary);
    const link = view.querySelector('a[href="https://discord.gg/5vJzfz5Zzy"]');
    expect(view.textContent).toContain(dictionary["nightly.support.title"]);
    expect(dictionary["nightly.support.includeMessage"]).toContain("{supportLink}");
    expect(view.textContent).toContain(dictionary["nightly.support.includeMessage"].replace("{supportLink}", dictionary["support.discord"]));
    expect(link?.textContent).toBe(dictionary["support.discord"]);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
});

it("claim page shows the form for the pending device and escapes the Discord username", async () => {
    mocks.cookies.set("nightly_claim", encodeClaimContext({ deviceId: DEVICE_ID, username: "<img src=x onerror=alert(1)>", previousSponsorRevoked: true }));
    const view = render(await SponsorClaimPage());
    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector("strong")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(view.textContent).toContain("Previous sponsor access ended");
    expect(view.querySelector('input[name="sponsor_code"]')).not.toBeNull();
    expect(view.innerHTML).not.toContain(DEVICE_ID);
});

it("claim page without a pending claim explains the authorization expired", async () => {
    const view = render(await SponsorClaimPage());
    expect(view.querySelector("form")).toBeNull();
    expect(view.querySelector('[role="alert"]')?.textContent).toBe("That installer authorization has expired.");
});

it("sponsor page renders the seat list, shows the expired login for a rejected session and offers re-login when ineligible", async () => {
    mocks.cookies.set("nightly_sponsor", SESSION);
    mocks.client = { sponsorPortal: async () => ({ ok: true, value: { seats: [{ discordUserId: "123456789012345678", createdAt: null }] } }) };
    const portal = render(await SponsorPage(params()));
    expect(portal.querySelector('[aria-label="1 of 10 seats used"]')).not.toBeNull();
    expect(portal.querySelector("code")?.textContent).toBe("123456789012345678");

    mocks.client = { sponsorPortal: async () => ({ ok: false, status: 401, code: "authorization_expired" }) };
    const expired = render(await SponsorPage(params()));
    expect(expired.querySelector('[role="status"]')?.textContent).toContain("Your sponsor session has ended.");
    expect(mocks.redirect).not.toHaveBeenCalled();

    mocks.client = { sponsorPortal: async () => ({ ok: false, status: 403, code: "supporter_role_required" }) };
    const ineligible = render(await SponsorPage(params()));
    expect(ineligible.querySelector('a[href="/nightly/sponsor/login"]')?.textContent).toContain("Sign in again");
});

it("sponsor page shows the expired notice after an action dropped the session", async () => {
    const view = render(await SponsorPage(params({ session: "expired" })));
    expect(view.querySelector('[role="status"]')?.textContent).toContain("Your sponsor session has ended.");
    const fresh = render(await SponsorPage(params()));
    expect(fresh.querySelector('[role="status"]')).toBeNull();
});

it("a finished server action sets its plan's cookies with the route handlers' attributes, then redirects", async () => {
    const plan = { location: "/nightly/approved?via=sponsor", cookies: [{ name: "nightly_claim", value: "", maxAge: 0 }] };
    await expect(carryOut({ redirect: plan })).rejects.toThrow("redirect:");
    expect(mocks.setCookie).toHaveBeenCalledExactlyOnceWith("nightly_claim", "", {
        path: "/nightly", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax",
    });
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/nightly/approved?via=sponsor");
});

it("a server action redirect without cookies only redirects, and a form state is returned as is", async () => {
    await expect(carryOut({ redirect: { location: "/nightly/sponsor", cookies: [] } })).rejects.toThrow("redirect:/nightly/sponsor");
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(await carryOut({ state: { error: "x" } })).toEqual({ error: "x" });
});
