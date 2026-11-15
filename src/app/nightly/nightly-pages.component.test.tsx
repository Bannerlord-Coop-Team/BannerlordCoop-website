import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { NightlyClient } from "@/app/lib/nightly/client";
import { encodeClaimContext } from "@/app/lib/nightly/cookies";

const mocks = vi.hoisted(() => ({
    cookies: new Map<string, string>(),
    client: {} as Partial<NightlyClient>,
}));
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect: (location: string) => { throw new Error(`redirect:${location}`); } }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/app/lib/nightly/server", () => ({ getNightlyClient: () => mocks.client }));
vi.mock("@/app/nightly/claim/actions", () => ({ claimSponsorSeat: vi.fn() }));
vi.mock("@/app/nightly/sponsor/actions", () => ({ createSponsorCode: vi.fn(), removeSponsoredSeat: vi.fn() }));

import ApprovedPage from "./approved/page";
import SponsorClaimPage from "./claim/page";
import NightlyErrorPage from "./error/page";
import NightlyAccessPage from "./page";
import SponsorPage from "./sponsor/page";

const SESSION = "s".repeat(43);

afterEach(() => {
    mocks.cookies.clear();
    mocks.client = {};
});

/** Renders a server page element into a detached DOM node. */
function render(element: React.ReactElement): HTMLDivElement {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(element);
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
    expect(view.querySelector("h1")?.textContent).toBe("Test tomorrow’s battles today.");
});

it("success page tells the user to return to the installer", async () => {
    expect(render(await ApprovedPage(params())).textContent).toContain("Access approvedReturn to the installer window. It will continue automatically.");
    expect(render(await ApprovedPage(params({ via: "sponsor" }))).querySelector("h1")?.textContent).toBe("Sponsored access approved");
});

it("error page renders only canned copy for the context and code", async () => {
    const expired = render(await NightlyErrorPage(params({ context: "activate", code: "expired" })));
    expect(expired.querySelector('[role="alert"]')?.textContent).toBe("That installer code has expired.");
    const role = render(await NightlyErrorPage(params({ context: "callback", code: "supporter_role_required" })));
    expect(role.textContent).toContain("Have a sponsor code?");
    const forged = render(await NightlyErrorPage(params({ context: "<script>", code: "<img src=x onerror=alert(1)>" })));
    expect(forged.querySelector("img, script")).toBeNull();
    expect(forged.querySelector('[role="alert"]')?.textContent).toBe("Access could not be verified. Run the installer again or ask in the Bannerlord Co-op Discord.");
});

it("claim page shows the form for the pending device and escapes the Discord username", async () => {
    mocks.cookies.set("nightly_claim", encodeClaimContext({ deviceId: "device-1", username: "<img src=x onerror=alert(1)>", previousSponsorRevoked: true }));
    const view = render(await SponsorClaimPage());
    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector("strong")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(view.textContent).toContain("Previous sponsor access ended");
    expect(view.querySelector('input[name="sponsor_code"]')).not.toBeNull();
    expect(view.innerHTML).not.toContain("device-1");
});

it("claim page without a pending claim explains the authorization expired", async () => {
    const view = render(await SponsorClaimPage());
    expect(view.querySelector("form")).toBeNull();
    expect(view.querySelector('[role="alert"]')?.textContent).toBe("That installer authorization has expired.");
});

it("sponsor page: no cookie shows login, seats render, 401 clears the session, 403 explains lost eligibility", async () => {
    const login = render(await SponsorPage(params()));
    expect(login.querySelector('a[href="/nightly/sponsor/login"]')?.textContent).toContain("Continue with Discord");

    mocks.cookies.set("nightly_sponsor", SESSION);
    mocks.client = { sponsorPortal: async () => ({ ok: true, value: { limit: 10, seats: [{ discordUserId: "123456789012345678", createdAt: null }] } }) };
    const portal = render(await SponsorPage(params()));
    expect(portal.querySelector('[aria-label="1 of 10 seats used"]')).not.toBeNull();
    expect(portal.querySelector("code")?.textContent).toBe("123456789012345678");

    mocks.client = { sponsorPortal: async () => ({ ok: false, status: 401, code: "authorization_expired" }) };
    await expect(SponsorPage(params())).rejects.toThrow("redirect:/nightly/sponsor/logout");
    const relogin = render(await SponsorPage(params({ session: "expired" })));
    expect(relogin.textContent).toContain("Your sponsor session has ended.");

    mocks.client = { sponsorPortal: async () => ({ ok: false, status: 403, code: "supporter_role_required" }) };
    const ineligible = render(await SponsorPage(params()));
    expect(ineligible.querySelector('[role="alert"]')?.textContent).toBe("A Staff, Tester, Patreon, Boosty, or Afdian role is required.");
    expect(ineligible.querySelector('a[href="/nightly/sponsor/login"]')).not.toBeNull();
});
